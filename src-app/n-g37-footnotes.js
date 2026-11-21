// g37 — footnotes core plugin (clean-room). Factories: ng37FootnoteItem / ng37FootnotesView / ng37FootnotesPlugin.
import { env } from "./env.js";
import { inherit, methods } from "./inherit.js";
import { defineLinkPaneView } from "./n-g11-linkpanes.js";

export const ng37FootnotesViewType = "footnotes";

const ng37PaneStrings = () => env().gm.plugins.footnotesPane;

let ng37FootnoteItemClass = null;
let ng37FootnotesViewClass = null;
let ng37FootnotesPluginClass = null;

const ng37EscapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Row component: badge + editable embed of one "[^id]" definition. */
export function ng37FootnoteItem(host) {
  if (ng37FootnoteItemClass) return ng37FootnoteItemClass;

  function FootnoteItem(app, file, footnoteId, index, footRefPositions) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.file = file;
    self.footnoteId = footnoteId;
    self.embed = null;
    self._defText = null;
    self.containerEl = document.createElement("div");
    self.containerEl.className = "footnote-list-item";
    const foot = document.createElement("div");
    foot.className = "footnote";
    self.idEl = document.createElement("div");
    self.idEl.className = "footnote-id";
    self.contentEl = document.createElement("div");
    self.contentEl.className = "footnote-content";
    foot.appendChild(self.idEl);
    foot.appendChild(self.contentEl);
    self.containerEl.appendChild(foot);
    self.update(index, footRefPositions || []);
    return self;
  }
  inherit(FootnoteItem, host.Component);
  methods(FootnoteItem, {
    update(index, footRefPositions) {
      this._index = index;
      this._footRefPositions = footRefPositions || [];
      const text = String(index + 1);
      if (this.idEl.textContent !== text) this.idEl.textContent = text;
      const noOcc = this._footRefPositions.length === 0;
      this.idEl.classList.toggle("mod-no-occurrences", noOcc);
    },

    onload() {
      return this.renderEmbed();
    },

    onunload() {
      if (this.containerEl && this.containerEl.detach) this.containerEl.detach();
    },

    async renderEmbed() {
      const linktext = "#[^" + this.footnoteId + "]";
      const embedContainer = document.createElement("div");
      this.contentEl.appendChild(embedContainer);
      const embed = new host.EmbedFileView(
        { app: this.app, linktext, sourcePath: this.file.path, containerEl: embedContainer, depth: 0 },
        this.file,
        linktext
      );
      embed.editable = true;
      this.embed = embed;
      if (typeof embed.load === "function") this.addChild(embed);

      this.containerEl.addEventListener("click", (evt) => {
        if (this.containerEl.hasClass("is-editing")) return;
        if (embed.editMode) return;
        this.containerEl.addClass("is-editing");
        const point = { x: evt.clientX, y: evt.clientY };
        if (typeof embed.showEditor === "function") embed.showEditor(point);
        const onDown = (down) => {
          if (this.containerEl.contains(down.targetNode || down.target)) return;
          window.removeEventListener("mousedown", onDown, true);
          this.containerEl.classList.remove("is-editing");
          try {
            if (embed.editMode && typeof embed.editMode.hide === "function") embed.editMode.hide();
            else if (typeof embed.hideEditor === "function") embed.hideEditor();
          } catch (err) { /* best effort */ }
        };
        window.addEventListener("mousedown", onDown, true);
        this.register(() => window.removeEventListener("mousedown", onDown, true));
      });

      if (typeof embed.loadFile === "function") await embed.loadFile();
    },

    onResize() {
      const renderer = this.embed && this.embed.previewMode && this.embed.previewMode.renderer;
      if (renderer && typeof renderer.onResize === "function") renderer.onResize();
    },
  });
  ng37FootnoteItemClass = FootnoteItem;
  return ng37FootnoteItemClass;
}

/** Side-pane view listing the current file's footnote definitions in first-reference order. */
export function ng37FootnotesView(host) {
  if (ng37FootnotesViewClass) return ng37FootnotesViewClass;
  const Base = defineLinkPaneView(host);

  function FootnotesView(leaf) {
    const self = Base.call(this, leaf) || this;
    self.icon = "lucide-file-signature";
    self.hoverPopover = null;
    self.cache = new Map();
    const wrap = self.contentEl.createDiv("footnotes-view");
    self.listEl = wrap.createDiv("footnotes-list");
    self.listEl.hide();
    self.emptyEl = wrap.createDiv("pane-empty");
    self.emptyEl.setText(ng37PaneStrings().labelNoFootnotes());
    self.emptyEl.hide();
    return self;
  }
  inherit(FootnotesView, Base);
  methods(FootnotesView, {
    getViewType() { return ng37FootnotesViewType; },
    getDisplayText() { return ng37PaneStrings().shortName(); },
    canAcceptExtension() { return true; },

    onload() {
      this.app = this.leaf && this.leaf.app ? this.leaf.app : this.app;
      if (this.app && this.app.metadataCache) {
        this.registerEvent(this.app.metadataCache.on("resolve", (file) => this.onCacheUpdate(file)));
      }
      this.requestUpdate();
    },

    onunload() { this.clearCache(); },

    onCacheUpdate(file) {
      if (file === this.file) this.requestUpdate();
    },

    onResize() {
      for (const item of this.cache.values()) {
        if (item && typeof item.onResize === "function") item.onResize();
      }
    },

    clearCache() {
      for (const item of this.cache.values()) {
        if (item && this._children && this._children.indexOf(item) !== -1) this.removeChild(item);
        else if (item && typeof item.unload === "function") item.unload();
      }
      this.cache.clear();
    },

    cleanCache(footnotes) {
      const keep = new Set(footnotes.map((f) => f.id));
      for (const [id, item] of Array.from(this.cache.entries())) {
        if (!keep.has(id)) {
          this.cache.delete(id);
          if (this._children && this._children.indexOf(item) !== -1) this.removeChild(item);
          else if (item && typeof item.unload === "function") item.unload();
        }
      }
    },

    async _definitionText(id) {
      try {
        const content = await this.app.vault.cachedRead(this.file);
        const re = new RegExp("\\[\\^" + ng37EscapeRe(id) + "\\]:\\s*([^\\n]*)");
        const m = content.match(re);
        return m ? m[1] : "";
      } catch (err) {
        return null;
      }
    },

    async renderFootnote(footnote, index, positions) {
      const id = footnote.id;
      const defText = await this._definitionText(id);
      let item = this.cache.get(id);
      if (item && defText !== null && item._defText === defText) {
        item.update(index, positions);
        return item;
      }
      if (item) {
        this.cache.delete(id);
        if (this._children && this._children.indexOf(item) !== -1) this.removeChild(item);
        else if (typeof item.unload === "function") item.unload();
        item.containerEl.detach && item.containerEl.detach();
      }
      item = new (ng37FootnoteItem(host))(this.app, this.file, id, index, positions);
      item._defText = defText;
      this.cache.set(id, item);
      this.addChild(item);
      return item;
    },

    async update() {
      const file = this.file;
      const cache = file && this.app.metadataCache.getFileCache(file);
      const footnotes = (cache && cache.footnotes) || [];
      const hasFootnotes = footnotes.length > 0;
      if (hasFootnotes) {
        this.listEl.show();
        this.emptyEl.hide();
      } else {
        this.listEl.hide();
        this.emptyEl.show();
        this.clearCache();
        return;
      }
      for (const item of this.cache.values()) {
        if (item && item.embed && item.embed.editMode) return;
      }

      const positionsById = new Map();
      const pushPos = (id, pos) => {
        if (!id || !pos) return;
        if (!positionsById.has(id)) positionsById.set(id, []);
        positionsById.get(id).push(pos);
      };
      const refs = (cache && cache.footnoteRefs) || [];
      for (const ref of refs) pushPos(ref.id, ref.position);
      for (const fn of footnotes) {
        if (fn.id && fn.id.indexOf("[inline") === 0) pushPos(fn.id, fn.position);
      }

      const offsetOf = (positions) => {
        const p = positions && positions[0];
        return p && p.start ? p.start.offset : Infinity;
      };
      const sorted = footnotes.slice().sort((a, b) => {
        const pa = positionsById.get(a.id) || [];
        const pb = positionsById.get(b.id) || [];
        if (pa.length && pb.length) return offsetOf(pa) - offsetOf(pb);
        if (pa.length) return -1;
        if (pb.length) return 1;
        return 1;
      });

      const els = [];
      for (let i = 0; i < sorted.length; i++) {
        const item = await this.renderFootnote(sorted[i], i, positionsById.get(sorted[i].id) || []);
        if (item && item.containerEl) els.push(item.containerEl);
      }
      if (this.listEl.setChildrenInPlace) this.listEl.setChildrenInPlace(els);
      else {
        this.listEl.empty();
        for (const el of els) this.listEl.appendChild(el);
      }
      this.cleanCache(sorted);
    },
  });
  ng37FootnotesViewClass = FootnotesView;
  return ng37FootnotesViewClass;
}

/** "footnotes" core plugin (disabled by default). */
export function ng37FootnotesPlugin(host) {
  if (ng37FootnotesPluginClass) return ng37FootnotesPluginClass;
  function Ng37FootnotesPlugin() {
    this.id = "footnotes";
    this.defaultOn = false;
    const t = ng37PaneStrings();
    this.name = t.name();
    this.description = t.desc();
  }
  const proto = Ng37FootnotesPlugin.prototype;
  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerViewType(ng37FootnotesViewType, (leaf) => new (ng37FootnotesView(host))(leaf));
    plugin.registerGlobalCommand({
      id: "footnotes:open",
      name: ng37PaneStrings().actionShow(),
      icon: "lucide-file-signature",
      callback: () => {
        this.app.workspace.ensureSideLeaf(ng37FootnotesViewType, "right", { active: true });
      },
    });
  };
  proto.onUserEnable = function () { this.initLeaf(); };
  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(ng37FootnotesViewType, "right", { reveal: false });
  };
  ng37FootnotesPluginClass = Ng37FootnotesPlugin;
  return ng37FootnotesPluginClass;
}
