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
      this.updateNodeLabel((path || "").split("/").pop() || "missing");
      if (this.isContentMounted) {
        this.contentEl.empty();
        const el = this.contentEl.createDiv("canvas-node-missing");
        el.createDiv("canvas-node-missing-icon");
        el.createDiv("canvas-node-missing-text").setText(path || "missing file");
        this.placeholderEl.hide();
      }
    }

    isEditable() { return false; }

    /** Renders through the app embed registry so md/media/pdf/canvas all work. */
    renderContent() {
      super.renderContent();
      const file = this.file;
      if (!file) { this.markMissing(this.missingPath || this.filePath); return; }
      this.placeholderEl.hide();
      this.contentEl.empty();
      this.child = null;
      this.embedEl = null;
      const registry = this.app.embedRegistry;
      const creator = registry && typeof registry.getEmbedCreator === "function" ? registry.getEmbedCreator(file) : null;
      if (creator) {
        const viewFile = this.canvas && this.canvas.view && this.canvas.view.file;
        const ctx = {
          app: this.app,
          containerEl: this.contentEl,
          linktext: file.path + (this.subpath || ""),
          sourcePath: viewFile ? viewFile.path : "",
          state: {},
          displayMode: false,
          showInline: false,
          editable: false,
        };
        try {
          const embed = creator(ctx, file, this.subpath || undefined);
          this.child = embed;
          if (embed && embed.containerEl && embed.containerEl !== this.contentEl) {
            // creator already owns containerEl (ctx.containerEl) in most cases
          }
          if (embed && typeof embed.loadFile === "function") embed.loadFile();
          else if (embed && typeof embed.load === "function") embed.load();
          else if (embed && typeof embed.onload === "function") embed.onload();
        } catch (err) {
          this.contentEl.setText(file.basename);
        }
      } else {
        this.contentEl.createDiv("canvas-node-generic").setText(file.basename);
      }
      this.updateNodeLabel(file.basename);
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
      if (self.file) {
        menu.addItem((item) => item.setSection("action").setTitle(ti.actionOpen ? ti.actionOpen() : "Open").setIcon("lucide-external-link").onClick(() => self.app.workspace.getLeaf().openFile(self.file)));
        menu.addItem((item) => item.setSection("action").setTitle(ti.actionReveal ? ti.actionReveal() : "Reveal in explorer").setIcon("lucide-folder-open").onClick(() => self.app.workspace.trigger("file-explorer:reveal-path", self.file.path)));
      }
      if (!canvas_.readonly) {
        menu.addItem((item) => item.setSection("danger").setTitle(ti.actionRemove ? ti.actionRemove() : "Remove").setIcon("lucide-trash-2").setWarning(true).onClick(() => canvas_.removeNode(self)));
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
      this.background = "";
      this.backgroundStyle = null;
      this.isTransparent = false;
      this.labelEl.show();
    }

    getData() {
      const out = super.getData();
      out.type = "group";
      if (this.label) out.label = this.label;
      if (this.background) out.background = this.background;
      if (this.backgroundStyle) out.backgroundStyle = this.backgroundStyle;
      return out;
    }

    setData(data) {
      super.setData(data);
      if (typeof data.label === "string") this.label = data.label;
      if (typeof data.background === "string") this.background = data.background;
      if (data.backgroundStyle && typeof data.backgroundStyle === "object") this.backgroundStyle = data.backgroundStyle;
      this.render();
    }

    labelText() { return this.label; }

    setLabel(label) {
      this.label = label || "";
      this.updateNodeLabel(this.label);
      this.canvas.markDirty(this);
      this.canvas.requestSave();
    }

    render() {
      super.render();
      this.nodeEl.addClass("canvas-node-group");
      this.nodeEl.toggleClass("canvas-node-group-transparent", this.isTransparent);
      if (this.backgroundStyle) this.containerEl.setCssStyles(this.backgroundStyle);
      this.updateNodeLabel(this.label);
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
