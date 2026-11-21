// g20 clean-room: file node (vault file cards incl. markdown/media/pdf/canvas
// rendering and missing-file placeholder), group node, canvas-markdown embed
// renderer and the path suggestion popup.
//
// Replaces orig P5/R5/a8/N8 (canvas-nodes.js + s33-canvas-nodes.js).
import { env } from "./env.js";
import { canvas } from "./n-g20-shared.js";
import { defineNg20CanvasNode, defineNg20EditableNode, defineNg20ContentMountNode } from "./n-g20-node.js";
import { ng20CanvasPreview } from "./n-g20-edge.js";
import { normalizePath } from "./path.js";
import { copyText } from "./misc.js";
import { isLightColor } from "./n-g25-misc.js";

// ---- file node (P5) -----------------------------------------------------------------------------

export function defineNg20FileNode(host) {
  const Base = canvas.EditableNode || defineNg20EditableNode(host);
  class FileNode extends Base {
    constructor(canvas_, id) {
      super(canvas_, id);
      this.type = "file";
      this.file = null;
      this.filePath = "";
      this.subpath = "";
      this.isMissing = false;
      this.embedEl = null;
      this.labelEl.addEventListener("click", (evt) => {
        if (!this.filePath) return;
        const leafType = host.Keymap.isModEvent(evt);
        if (leafType) this.app.workspace.getLeaf(leafType).openLinkText(this.filePath + this.subpath, "");
      });
      this.labelEl.addEventListener("dblclick", (evt) => {
        evt.stopPropagation();
        if (this.filePath) this.app.workspace.getLeaf(false).openLinkText(this.filePath + this.subpath, "");
      });
    }

    getData() {
      const out = super.getData();
      out.type = "file";
      if (this.file) out.file = this.file.path;
      else if (this.filePath) out.file = this.filePath;
      if (this.subpath) out.subpath = this.subpath;
      return out;
    }

    setData(data) {
      super.setData(data);
      if (typeof data.file === "string") this.setFilePath(data.file);
      if (typeof data.subpath === "string") this.subpath = data.subpath;
      this.updateNodeLabel(this.file ? this.file.basename : this.filePath || "");
    }

    /** Accepts a TFile (from the controller factory) or a raw path string. */
    setFile(file, subpath) {
      if (typeof subpath === "string") this.subpath = subpath;
      if (file && typeof file === "object" && file.path) {
        this.file = file;
        this.filePath = file.path;
        this.isMissing = false;
        this.updateNodeLabel(file.basename);
        this.contentEl.empty();
        this.child = null;
        this.embedEl = null;
        if (this.isContentMounted) this.renderContent();
        return;
      }
      this.setFilePath(typeof file === "string" ? file : "");
    }

    setFilePath(path) {
      this.filePath = path || "";
      const clean = normalizePath((this.filePath || "").split("#")[0].split("|")[0]);
      const file = clean ? this.app.vault.getAbstractFileByPath(clean) : null;
      if (file && file.extension) {
        this.file = file;
        this.isMissing = false;
        this.updateNodeLabel(file.basename);
        this.contentEl.empty();
        this.child = null;
        this.embedEl = null;
        if (this.isContentMounted) this.renderContent();
      } else {
        this.markMissing(this.filePath);
      }
    }

    markMissing(path) {
      this.file = null;
      this.isMissing = true;
      this.missingPath = path || "";
      this.updateNodeLabel((path || "") || "missing");
      if (this.isContentMounted) {
        this.contentEl.empty();
        this.child = null;
        const ctx = {
          app: this.app,
          linktext: this.filePath + (this.subpath || ""),
          sourcePath: this.canvas.view && this.canvas.view.file ? this.canvas.view.file.path : "",
          containerEl: this.contentEl,
          depth: 0,
        };
        this.child = new canvas.EmptyEmbed(ctx, this, () => this.render());
        if (typeof this.child.loadFile === "function") this.child.loadFile();
        this.placeholderEl.hide();
      }
    }

    labelText() {
      if (!this.file) return this.filePath || "";
      let label = this.file.basename || this.filePath || "";
      if (this.subpath && this.file.extension === "md") label += " › " + this.subpath.substring(1);
      return label;
    }

    isEditable() { return false; }

    blur() {
      super.blur();
      this.canvas.requestUpdateFileOpen(null);
    }

    /** Renders through host.EmbedLoader so md/media/pdf/canvas embeds all work. */
    renderContent() {
      super.renderContent();
      const file = this.file;
      if (!file) { this.markMissing(this.missingPath || this.filePath); return; }
      this.placeholderEl.hide();
      this.contentEl.empty();
      this.child = null;
      this.embedEl = null;
      const ctx = {
        app: this.app,
        linktext: this.filePath + (this.subpath || ""),
        sourcePath: this.canvas.view && this.canvas.view.file ? this.canvas.view.file.path : "",
        containerEl: this.contentEl,
        depth: 0,
      };
      let child;
      if (host.EmbedLoader && typeof host.EmbedLoader.load === "function") {
        child = host.EmbedLoader.load(ctx);
      } else {
        const creator = this.app.embedRegistry && this.app.embedRegistry.getEmbedCreator(file);
        child = creator ? creator(ctx, file, this.subpath || undefined) : null;
      }
      if (child) {
        this.child = child;
        if (child instanceof host.StatefulEmbedBase) {
          child.useLocalPropertiesFoldState = true;
          child.editable = true;
          child.useIframe = true;
        }
        if (this.isFocused) {
          const workspace = this.app.workspace;
          if (workspace) workspace.activeEditor = child instanceof host.MarkdownEmbedBase ? child : null;
          this.canvas.requestUpdateFileOpen(this.file);
        }
        child.load();
        (async () => {
          try { await child.loadFile(); } catch (err) { /* embed reports its own errors */ }
          const first = this.contentEl.firstChild;
          if (!first) return;
          let size = null;
          if (first instanceof HTMLImageElement) {
            size = { width: first.naturalWidth, height: first.naturalHeight };
            first.draggable = false;
          } else if (first instanceof HTMLVideoElement) {
            size = { width: first.videoWidth, height: first.videoHeight };
          } else if (first instanceof HTMLAudioElement) {
            const fix = () => this.resize({ width: this.width, height: first.clientHeight || 42 });
            if (first.isShown && first.isShown()) fix();
            else if (first.onNodeInserted) first.onNodeInserted(fix, true);
            fix();
          }
          if (size && size.height !== 0) {
            const ratio = size.width / size.height;
            const { width, height } = this;
            if (width / height !== ratio) {
              this.resize({ width: Math.min(width, height * ratio), height: Math.min(height, width / ratio) });
              if (this.canvas.overrideHistory) this.canvas.overrideHistory();
            }
          }
        })();
      } else {
        this.child = new canvas.EmptyEmbed(ctx, this, () => this.render());
        if (typeof this.child.loadFile === "function") this.child.loadFile();
      }
      this.updateNodeLabel(this.labelText());
    }

    render() {
      super.render();
      if (!this.isContentMounted) {
        const label = this.file ? (this.file.basename || this.filePath) : (this.filePath || "");
        this.placeholderEl.setText(label);
        this.placeholderEl.show();
      }
    }

    onDoubleClick(evt) {
      if (this.canvas.readonly || evt.defaultPrevented) return;
      if (this.file) {
        const leaf = this.app.workspace.getLeaf();
        leaf.openFile(this.file, this.subpath ? { eState: { subpath: this.subpath } } : undefined);
        return;
      }
      super.onDoubleClick(evt);
    }

    showMenu(evt) {
      const canvas_ = this.canvas;
      const menu = new host.Menu();
      const ti = env().gm.plugins.canvas;
      const self = this;
      menu.addSections(["title", "action", "clipboard", "danger"]);
      // a translation call that finds no key answers with the key itself: fall back to a plain label then
      const tr = (fn, fallback) => {
        try { const v = fn && fn(); return typeof v === "string" && v && !/^plugins\.|action-|^interface\./.test(v) ? v : fallback; } catch (e) { return fallback; }
      };
      if (self.file) {
        const file = self.file;
        const tm = host.t.interface.menu;
        menu.addItem((item) => item.setSection("action").setTitle(tr(tm.openInNewTab && tm.openInNewTab.bind(tm), "Open in a new tab")).setIcon("lucide-file-plus").onClick(() => self.app.workspace.getLeaf("tab").openFile(file)));
        menu.addItem((item) => item.setSection("action").setTitle(tr(env().gm.plugins.fileExplorer.actionRevealFile, "Show file in navigation")).setIcon("lucide-folder-search").onClick(() => self.app.workspace.trigger("file-explorer:reveal-path", file.path)));
        menu.addItem((item) => item.setSection("action").setTitle("Show in system explorer").setIcon("lucide-folder-open").onClick(() => { try { self.app.showInFolder(file); } catch (e) { /* not available */ } }));
      }
      if (!canvas_.readonly) {
        menu.addItem((item) => item.setSection("danger").setTitle(tr(ti.actionRemove, "Remove")).setIcon("lucide-trash-2").setWarning(true).onClick(() => canvas_.removeNode(self)));
      }
      canvas_.app.workspace.trigger("canvas:node-menu", menu, this);
      if (window.__fpNodeMenu) window.__fpNodeMenu(menu, this);
      menu.showAtMouseEvent(evt);
    }

    getConnectedFiles() {
      const s = new Set();
      if (this.file) s.add(this.file.path);
      return s;
    }
  }
  canvas.FileNode = FileNode;
  return FileNode;
}

// ---- group node (R5) -----------------------------------------------------------------------------

export function defineNg20GroupNode(host) {
  const Base = canvas.Node || defineNg20CanvasNode(host);
  class GroupNode extends Base {
    constructor(canvas_, id) {
      super(canvas_, id);
      this.type = "group";
      this.label = "";
      this.bgPath = "";
      this.bgFile = null;
      this.bgStyle = "";
      this.nodeEl.addClass("canvas-node-group");
      this.placeholderEl.hide();
      this.contentBlockerEl.hide();
      this.labelEl.spellcheck = false;
      this.labelEl.addEventListener("dblclick", (evt) => {
        evt.stopPropagation();
        this.focusLabel();
      });
    }

    labelClass() { return "canvas-group-label"; }

    getData() {
      const out = super.getData();
      out.type = "group";
      if (this.label) out.label = this.label;
      if (this.bgPath) {
        out.background = this.bgFile ? this.bgFile.path : this.bgPath;
        if (this.bgStyle && this.bgStyle !== "cover") out.backgroundStyle = this.bgStyle;
      }
      return out;
    }

    setData(data) {
      super.setData(data);
      if (typeof data.label === "string") this.setLabel(data.label);
      const bg = typeof data.background === "string" ? data.background : "";
      const bgStyle = typeof data.backgroundStyle === "string" ? data.backgroundStyle : "";
      if (bg) {
        this.bgPath = bg;
        const resolved = this.app.vault.getAbstractFileByPath(bg);
        this.bgFile = resolved && resolved.path ? resolved : null;
        this.bgStyle = bgStyle;
      } else {
        this.bgPath = "";
        this.bgFile = null;
        this.bgStyle = "";
      }
      this.render();
    }

    labelText() { return this.label; }

    setLabel(label) {
      this.label = label || "";
      this.updateNodeLabel(this.label);
      this.canvas.markDirty(this);
    }

    setBackgroundFile(file) {
      const path = file ? file.path : "";
      if (this.bgPath === path && this.bgFile === file) return;
      this.bgPath = path;
      this.bgFile = file || null;
      if (!file) this.bgStyle = "";
      this.render();
      this.canvas.markDirty(this);
    }

    setBackgroundStyle(style) {
      if (!this.bgPath) style = "";
      if (this.bgStyle !== style) {
        this.bgStyle = style;
        this.render();
        this.canvas.markDirty(this);
      }
    }

    render() {
      super.render();
      this.updateNodeLabel(this.label);
      // foreground legibility classes for themed groups
      let light = false, dark = false;
      const color = this.color;
      if (color) {
        const parsed = /^\d+$/.test(color)
          ? host.s13ParseColor("rgb(" + this.labelEl.getCssPropertyValue("--canvas-color-" + color) + ")")
          : host.s13ParseColor(color);
        if (parsed) {
          if (isLightColor(parsed)) dark = true;
          else light = true;
        }
      }
      this.labelEl.toggleClass("mod-foreground-light", light);
      this.labelEl.toggleClass("mod-foreground-dark", dark);
      const contentEl = this.contentEl;
      if (this.bgFile) {
        const styles = {
          backgroundImage: `url("${CSS.escape(this.app.vault.getResourcePath(this.bgFile))}")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center center",
          backgroundSize: "cover",
        };
        if (this.bgStyle === "repeat") {
          styles.backgroundRepeat = "repeat";
          styles.backgroundPosition = "top left";
          styles.backgroundSize = "auto";
        }
        contentEl.setCssStyles(styles);
      } else {
        contentEl.setCssStyles({ backgroundImage: "", backgroundRepeat: "", backgroundPosition: "", backgroundSize: "" });
      }
    }

    updateZIndex() { this.renderZIndex(); }

    renderZIndex() {
      this.zIndex = Math.round(-this.width * this.height);
      this.nodeEl.style.zIndex = String(this.zIndex);
    }

    attach() {
      super.attach();
      const parent = this.nodeEl.parentNode;
      if (parent && parent.firstChild !== this.nodeEl) parent.insertBefore(this.nodeEl, parent.firstChild);
    }

    isEditable() { return true; }

    startEditing() { this.focusLabel(); }

    /** Converts the group into a markdown file listing its member files. */
    async convertToFile() {
      const canvas_ = this.canvas;
      const app = this.app;
      const b = this.getBBox();
      const members = [];
      for (const n of canvas_.nodes.values()) {
        if (n === this || !n.getBBox) continue;
        const nb = n.getBBox();
        if (nb.minX >= b.minX && nb.minY >= b.minY && nb.maxX <= b.maxX && nb.maxY <= b.maxY && n.file) {
          members.push("![[" + n.file.path + "]]");
        }
      }
      const text = (this.label ? "# " + this.label + "\n\n" : "") + members.join("\n") + "\n";
      const folder = canvas_.view && canvas_.view.file ? canvas_.view.file.parent : app.vault.getRoot();
      const base = (this.label || "Group").replace(/[\\/:*?"<>|#^[\]]/g, "").slice(0, 60) || "Group";
      let name = base + ".md", i = 1;
      const prefix = folder && folder.path !== "/" ? folder.path + "/" : "";
      while (app.vault.getAbstractFileByPath(prefix + name)) name = base + " " + i++ + ".md";
      try {
        const file = await app.vault.create(prefix + name, text);
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
  canvas.GroupNode = GroupNode;
  return GroupNode;
}

// ---- path suggestion popup (N8) -----------------------------------------------------------------

export function defineNg20PathSuggest(host) {
  class PathSuggest extends host.FuzzySuggestModal {
    constructor(owner, onPick, opts = {}) {
      super(owner && owner.app ? owner.app : owner);
      this.owner = owner;
      this.app = owner && owner.app ? owner.app : owner;
      this.onPick = onPick;
      this.opts = opts || {};
      this.setPlaceholder(opts.placeholder || "Search files…");
    }

    getItems() {
      const q = (this.inputEl ? this.inputEl.value : "") || "";
      void q;
      const files = this.app.vault.getMarkdownFiles ? this.app.vault.getMarkdownFiles() : [];
      return files.map((f) => ({ value: f.path, display: f.path.replace(/\.md$/i, ""), file: f }));
    }

    getItemText(item) { return item ? item.display : ""; }

    onChooseItem(item) {
      if (item && this.onPick) this.onPick(item.value, item.file);
    }
  }
  canvas.PathSuggest = PathSuggest;
  return PathSuggest;
}

// ---- canvas markdown embed (a8) -----------------------------------------------------------------
// Registered as the embedRegistry creator for ".canvas": (ctx, file, subpath).

export function defineNg20CanvasEmbed(host) {
  class CanvasEmbed {
    constructor(ctx, file, subpath) {
      this.ctx = ctx || {};
      this.app = (ctx && ctx.app) || (file && file.app) || null;
      this.file = file || null;
      this.subpath = subpath || "";
      this.containerEl = (ctx && ctx.containerEl) || createDiv("canvas-embed inline-embed");
      if (this.containerEl && this.containerEl.classList) this.containerEl.classList.add("canvas-embed", "inline-embed");
      this.loaded = false;
    }

    load() {
      if (this.loaded) return;
      this.loaded = true;
      const self = this;
      const build = async () => {
        this.containerEl.empty();
        const title = this.containerEl.createDiv("embed-title");
        title.setText(this.file ? this.file.basename : "canvas");
        const body = this.containerEl.createDiv("canvas-embed-body");
        try {
          const text = await this.app.vault.read(this.file);
          ng20CanvasPreview(body.createDiv("canvas-minimap-wrap"), text, host);
        } catch (err) {
          body.setText("Unable to load canvas");
        }
        const open = this.containerEl.createDiv("canvas-embed-open");
        open.setText("Open");
        open.addEventListener("click", (evt) => {
          evt.stopPropagation();
          self.app.workspace.getLeaf().openFile(self.file);
        });
      };
      build();
    }

    loadFile() { this.load(); }
    onload() { this.load(); }
    unload() { this.containerEl.empty(); this.loaded = false; }
  }
  canvas.CanvasEmbed = CanvasEmbed;
  return CanvasEmbed;
}
