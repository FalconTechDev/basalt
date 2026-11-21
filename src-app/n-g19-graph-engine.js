// g19 clean-room: per-view graph data engine — search pipeline, node
// collection, timelapse progression, node interaction and control wiring.
import { env } from "./env.js";
import { debounceCall } from "./timing.js";
import { fileClass } from "./vault.js";
import { extensionOf } from "./path.js";
import { collectTags } from "./n-g22-helpers.js";
import { sliderCurve } from "./misc.js";
import { ng19GraphDefaults, ng19GraphNodeData, ng19GraphLocalData, } from "./n-g19-graph-util.js";
import { ng19GT, ng19Graph, ng19LocalGraphViewType, ng19Host } from "./n-g19-graph-consts.js";

const ng19EngineClamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Extensions whose files carry no searchable text content (binary attachments). */
function ng19AttachmentExtensions() {
  const host = ng19Host();
  const set = new Set();
  for (const key of ["imageExtensions", "audioExtensions", "videoExtensions", "pdfExtensions"]) {
    const v = host[key];
    const list = typeof v === "string" ? v.split(",") : (v || []);
    for (const e of list) set.add(String(e).replace(/^\./, "").toLowerCase());
  }
  return set;
}

/** Manifest factory: memoized graph engine class. */
export function ng19GraphEngine() {
  if (ng19Graph.Engine) return ng19Graph.Engine;
  const RendererCls = ng19Graph.Renderer || null;

  class Ng19GraphEngine {
    constructor(app, view, renderer) {
      this.app = app;
      this.view = view;
      this.renderer = renderer;
      this.options = Object.assign({}, ng19GraphDefaults);
      this.searchQueries = null;
      this.fileFilter = {};
      this.hasFilter = false;
      this.queue = null;
      this.progression = 0;
      this.progressionSpeed = 0;
      this.currentFocusFile = null;
      this.lastHoverLink = null;
      this.hoverPopover = null;
      this.isLocalGraph = !!(view && view.getViewType && view.getViewType() === ng19LocalGraphViewType);
      this._renderSeq = 0;
      this._inProg = false;
      this._progTimer = null;
      this._lastNumLinks = 0;
      this._lastScale = renderer ? renderer.targetScale : 1;
      this.controlsEl = null;
      this.filterOptions = null;
      this.colorOptions = null;
      this.colorGroupOptions = null;
      this.displayOptions = null;
      this.forceOptions = null;

      const self = this;
      this.onOptionsChange = debounceCall(() => {
        if (view && view.onOptionsChange) view.onOptionsChange();
      }, 100);
      this.requestUpdateSearch = debounceCall(() => this.updateSearch(), 250);
      this.requestRender = debounceCall(() => this.render(), 200);

      if (renderer) {
        renderer.onNodeClick = (evt, linktext, type) => this.onNodeClick(evt, linktext, type);
        renderer.onNodeRightClick = (evt, linktext, type) => this.onNodeRightClick(evt, linktext, type);
        renderer.onNodeHover = (evt, linktext, type) => this.onNodeHover(evt, linktext, type);
        renderer.onNodeUnhover = () => this.onNodeUnhover();
      }
      this._buildControls();
    }

    // ------------------------------------------------------------ controls

    _buildControls() {
      const host = ng19Host();
      const renderer = this.renderer;
      const view = this.view;
      if (!renderer || !renderer.containerEl) return;
      const controls = renderer.containerEl.createDiv("graph-controls");
      controls.dataset.ignoreSwipe = "true";
      this.controlsEl = controls;

      const mkBtn = (mod, icon, tip, fn) => {
        const b = controls.createEl("button", { cls: "graph-controls-button " + mod });
        host.setIcon(b, icon);
        host.setTooltip(b, tip);
        b.addEventListener("click", fn);
      };
      mkBtn("mod-close", "lucide-x", ng19GT("tooltipOpenGraphSettings") && __basaltHost.t.interface.menu.close ? __basaltHost.t.interface.menu.close() : "Close", () => {
        controls.addClass("is-close");
        this.onOptionsChange();
      });
      mkBtn("mod-open", "lucide-settings", ng19GT("tooltipOpenGraphSettings"), () => {
        controls.removeClass("is-close");
        this.onOptionsChange();
      });
      if (!this.isLocalGraph) {
        mkBtn("mod-animate", "lucide-wand-2", ng19GT("tooltipStartTimelapseAnimation"), () => this.renderProgression());
      }
      mkBtn("mod-reset", "lucide-rotate-ccw", __basaltHost.t.interface.tooltipRestoreDefaultSettings ? __basaltHost.t.interface.tooltipRestoreDefaultSettings() : "Restore default settings", () => {
        for (const s of [this.filterOptions, this.colorOptions, this.displayOptions, this.forceOptions]) {
          if (s && s.setDefaultOptions) s.setDefaultOptions();
        }
        this.render();
        this.onOptionsChange();
      });

      const C = ng19Graph;
      const mk = (key) => {
        const Cls = C[key];
        if (!Cls) return null;
        const section = new Cls(this);
        controls.appendChild(section.el);
        return section;
      };
      this.filterOptions = mk("FilterSection", "filter");
      this.colorOptions = mk("ColorSection", "color-groups");
      this.colorGroupOptions = this.colorOptions;
      this.displayOptions = mk("DisplaySection", "display");
      this.forceOptions = mk("ForceSection", "forces");
      for (const s of [this.filterOptions, this.colorOptions, this.displayOptions, this.forceOptions]) {
        if (s && s.setDefaultOptions) s.setDefaultOptions();
      }
    }

    // ------------------------------------------------------------ options

    getOptions() {
      const out = {};
      for (const s of [this.filterOptions, this.colorOptions, this.displayOptions, this.forceOptions]) {
        if (s && s.getOptions) s.getOptions(out);
      }
      out.scale = this.renderer ? this.renderer.targetScale : 1;
      out.close = this.controlsEl ? this.controlsEl.hasClass("is-close") : false;
      return out;
    }

    setOptions(options) {
      if (!options || typeof options !== "object") return;
      for (const s of [this.filterOptions, this.colorOptions, this.displayOptions, this.forceOptions]) {
        if (s && s.setOptions) s.setOptions(options);
      }
      if (options.scale && this.renderer) this.renderer.zoomTo(options.scale);
      if (this.controlsEl) this.controlsEl.toggleClass("is-close", !!options.close);
      this.render();
    }

    // ------------------------------------------------------------ lifecycle

    load() {
      const view = this.view, app = this.app;
      if (!view || !app) return;
      const vault = app.vault, mc = app.metadataCache, ws = app.workspace;
      const on = (emitter, type, cb) => {
        if (view.registerEvent) view.registerEvent(emitter.on(type, cb));
        else emitter.on(type, cb);
      };
      on(vault, "create", (f) => this.onFileChanged(f));
      on(vault, "modify", (f) => this.onFileChanged(f));
      on(vault, "rename", (f) => this.recomputeFile(f));
      on(mc, "resolve", (f) => this.recomputeFile(f));
      on(ws, "css-change", () => { if (this.renderer) this.renderer.testCSS(); });
      on(ws, "file-open", (f) => {
        const p = f ? f.path : null;
        if (p !== this.currentFocusFile) {
          this.currentFocusFile = p;
          this.render();
        }
      });
      this._scaleTimer = setInterval(() => {
        if (this.renderer && this.renderer.targetScale !== this._lastScale) {
          this._lastScale = this.renderer.targetScale;
          this.onOptionsChange();
        }
      }, 2000);

      const kd = (e) => this._onKey(e, true);
      const ku = (e) => this._onKey(e, false);
      const reg = (type, cb) => {
        if (view.registerDomEvent) view.registerDomEvent(window, type, cb);
        else window.addEventListener(type, cb);
      };
      reg("keydown", kd);
      reg("keyup", ku);
    }

    _onKey(e, down) {
      const r = this.renderer;
      if (!r) return;
      const k = r.keyboardActions;
      const code = e.keyCode || e.which || 0;
      const key = e.key;
      const isArrow = code === 38 || code === 40 || code === 37 || code === 39 || key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
      const isZoom = code === 187 || code === 189 || code === 61 || code === 173 || key === "=" || key === "+" || key === "-" || key === "_";
      if (!isArrow && !isZoom) return;
      if (down) {
        if (e.repeat || e.defaultPrevented) return;
        const ws = this.app.workspace;
        if (!ws || ws.activeLeaf !== this.view.leaf) return;
        if (typeof document !== "undefined" && document.activeElement && document.activeElement !== document.body) return;
      }
      const boost = ng19Host().Keymap.isModEvent(e);
      const up = code === 38 || key === "ArrowUp";
      const dn = code === 40 || key === "ArrowDown";
      const lf = code === 37 || key === "ArrowLeft";
      const rt = code === 39 || key === "ArrowRight";
      const zin = code === 187 || code === 61 || key === "=" || key === "+";
      const zout = code === 189 || code === 173 || key === "-" || key === "_";
      if (up) k.up = down;
      if (dn) k.down = down;
      if (lf) k.left = down;
      if (rt) k.right = down;
      if (zin) k.zoomin = down;
      if (zout) k.zoomout = down;
      k.boost = boost;
    }

    // ------------------------------------------------------------ search

    updateSearch() {
      const opts = this.options;
      const entries = [];
      const text = (opts.search || "").trim();
      if (text) entries.push({ text: opts.search, color: null });
      const groups = this.colorOptions && this.colorOptions.getColoredQueries ? this.colorOptions.getColoredQueries() : [];
      for (const g of groups) {
        if (g && g.query && String(g.query).trim()) entries.push({ text: g.query, color: g.color || null });
      }
      this.setQuery(entries);
    }

    setQuery(list) {
      const parsed = [];
      let requiredInputs = {};
      for (const q of list || []) {
        let query = null;
        try { query = new (env().BH)(this.app, q.text, false); } catch (e) { continue; }
        if (!query || !query.matcher) continue;
        if (query.requiredInputs) Object.assign(requiredInputs, query.requiredInputs);
        parsed.push({ query, color: q.color || null });
      }
      this.searchQueries = parsed.length ? parsed : null;
      this.hasFilter = parsed.some((p) => !p.color);
      if (!parsed.length) {
        this.fileFilter = {};
        this._stopSearchUI();
        this.render();
        return;
      }
      this._runSearch(requiredInputs);
    }

    _runSearch(requiredInputs) {
      const self = this;
      const app = this.app;
      const mc = app.metadataCache;
      if (this.queue && this.queue.cancel) { try { this.queue.cancel(); } catch (e) {} }
      const job = { cancelled: false, running: true };
      this.queue = job;
      this.fileFilter = {};
      if (this.filterOptions && this.filterOptions.startSearch) this.filterOptions.startSearch();
      const needContent = !!(requiredInputs && requiredInputs.content);
      const queries = this.searchQueries;
      const files = app.vault.getFiles();
      let lastRender = 0;
      const flush = () => {
        const now = Date.now();
        if (now - lastRender > 333) { lastRender = now; self.render(); }
      };
      (async () => {
        try {
          for (const file of files) {
            if (job.cancelled) return;
            if (!file || typeof file.path !== "string") continue;
            if (mc.isUserIgnored(file.path)) continue;
            if (!mc.isSupportedFile(file)) continue;
            let content = "";
            const ext = file.extension || "";
            if (needContent && (ext === "md" || ext === "canvas")) {
              try { content = await app.vault.cachedRead(file); } catch (e) { content = ""; }
            }
            let verdict;
            for (const p of queries) {
              const m = p.query.match(file, content);
              if (p.color) {
                if (m) { verdict = p.color; break; }
              } else if (!m) { verdict = false; break; }
            }
            if (verdict === undefined) verdict = true;
            self.fileFilter[file.path] = verdict;
            flush();
          }
        } finally {
          job.running = false;
          if (this.filterOptions && this.filterOptions.stopSearch) this.filterOptions.stopSearch();
          if (!job.cancelled) self.render();
        }
      })();
      job.cancel = () => { job.cancelled = true; if (this.filterOptions && this.filterOptions.stopSearch) this.filterOptions.stopSearch(); };
    }

    _stopSearchUI() {
      if (this.filterOptions && this.filterOptions.stopSearch) this.filterOptions.stopSearch();
    }

    // ------------------------------------------------------------ collect

    _admit(path, kind) {
      // returns true | colour object | false
      const opts = this.options;
      if (kind === "") {
        if (opts.localFile && path === opts.localFile) return true;
        if (!this.searchQueries) return !this.hasFilter;
        const v = this.fileFilter[path];
        return v === undefined ? !this.hasFilter : v;
      }
      if (kind === "unresolved") return true;
      const queries = this.searchQueries;
      if (!queries || !queries.length) return true;
      for (const p of queries) {
        if (p.color) continue;
        if (kind === "tag") { if (!p.query.matchTag(path)) return false; }
        else if (kind === "attachment") { if (!p.query.matchFilepath(path)) return false; }
      }
      return true;
    }

    _addLink(nodes, from, to, kind) {
      const target = nodes[to] || (nodes[to] = ng19GraphNodeData(kind));
      const src = nodes[from];
      if (src) src.links[to] = true;
      return target;
    }

    render() {
      this._renderSeq++;
      if (this.progression && !this._inProg) this._stopProgression();
      const r = this.renderer;
      const opts = this.options;
      const app = this.app;
      if (!r) return;
      if (opts.localFile == null && this.isLocalGraph) {
        r.setData({ nodes: {} });
        return;
      }
      const mc = app.metadataCache;
      if (!mc) { r.setData({ nodes: {} }); return; }

      const attachExts = ng19AttachmentExtensions();
      const tagDisplay = {};
      try {
        const tags = mc.getTags();
        for (const t in tags) tagDisplay[String(t).toLowerCase()] = t;
      } catch (e) { /* noop */ }

      let files = mc.getCachedFiles ? mc.getCachedFiles() : [];
      files = files.slice();
      if (this.progression) {
        files.sort((a, b) => {
          const fa = app.vault.getAbstractFileByPath(a), fb = app.vault.getAbstractFileByPath(b);
          const sa = fa && fa.stat ? Math.min(fa.stat.ctime || 0, fa.stat.mtime || 0) : Infinity;
          const sb = fb && fb.stat ? Math.min(fb.stat.ctime || 0, fb.stat.mtime || 0) : Infinity;
          return sa - sb;
        });
      }

      const nodes = {};
      let numLinks = 0;
      const prog = this.progression | 0;

      for (const path of files) {
        if (prog > 0 && numLinks >= prog) break; // timelapse truncation point passed
        const ext = extensionOf(path);
        const isAttach = attachExts.has(ext);
        if (isAttach && !opts.showAttachments) continue;
        const kind = isAttach ? "attachment" : "";
        const verdict = this._admit(path, kind);
        if (verdict === false) continue;
        if (mc.isUserIgnored(path)) continue;
        if (!nodes[path]) {
          const rec = ng19GraphNodeData(kind);
          if (verdict !== true) rec.color = verdict;
          nodes[path] = rec;
        }
        numLinks++;

        // resolved links
        const resolved = mc.resolvedLinks ? (mc.resolvedLinks[path] || {}) : {};
        for (const t in resolved) {
          if (!Object.hasOwn(resolved, t)) continue;
          const text = t;
          const dest = mc.getFirstLinkpathDest ? mc.getFirstLinkpathDest(text, path) : null;
          const tpath = dest ? dest.path : text;
          const text2 = extensionOf(tpath);
          const tAttach = attachExts.has(text2);
          if (tAttach && !opts.showAttachments) continue;
          const tKind = tAttach ? "attachment" : "";
          const tv = this._admit(tpath, tKind);
          if (tv === false) continue;
          if (!nodes[tpath]) {
            const rec = ng19GraphNodeData(tKind);
            if (tv !== true) rec.color = tv;
            nodes[tpath] = rec;
          }
          nodes[path].links[tpath] = true;
          numLinks++;
        }
        // unresolved links
        if (!opts.hideUnresolved) {
          const unres = mc.unresolvedLinks ? (mc.unresolvedLinks[path] || {}) : {};
          for (const t in unres) {
            if (!Object.hasOwn(unres, t)) continue;
            if (!nodes[t]) nodes[t] = ng19GraphNodeData("unresolved");
            nodes[path].links[t] = true;
            numLinks++;
          }
        }
        // tags
        if (opts.showTags) {
          try {
            const cache = mc.getCache ? mc.getCache(path) : null;
            const list = collectTags(cache);
            if (list) {
              for (const tag of list) {
                const lower = String(tag).toLowerCase();
                const display = tagDisplay[lower] || tag;
                if (!nodes[display]) nodes[display] = ng19GraphNodeData("tag");
                nodes[path].links[display] = true;
                numLinks++;
              }
            }
          } catch (e) { /* noop */ }
        }
      }
      this._lastNumLinks = numLinks;

      let out = { nodes, weights: undefined };
      if (opts.localFile != null) {
        out = ng19GraphLocalData({ nodes }, {
          localFile: opts.localFile,
          localJumps: opts.localJumps,
          localInterlinks: opts.localInterlinks,
          localForelinks: opts.localForelinks,
          localBacklinks: opts.localBacklinks,
        });
      }
      if (!opts.showOrphans) out = this._pruneOrphans(out);
      const focus = this.currentFocusFile;
      if (focus && out.nodes && out.nodes[focus]) out.nodes[focus].type = "focused";
      r.setData(out);
      return numLinks;
    }

    _pruneOrphans(data) {
      const nodes = data.nodes || {};
      const linked = new Set();
      for (const id in nodes) {
        if (!Object.hasOwn(nodes, id)) continue;
        const links = nodes[id].links || {};
        for (const t in links) {
          if (!Object.hasOwn(links, t) || t === id) continue;
          if (nodes[t]) { linked.add(id); linked.add(t); }
        }
      }
      const kept = {};
      const weights = {};
      for (const id in nodes) {
        if (!Object.hasOwn(nodes, id)) continue;
        if (linked.has(id) || id === this.options.localFile) kept[id] = nodes[id];
        if (data.weights && data.weights[id] !== undefined) weights[id] = data.weights[id];
      }
      return { nodes: kept, weights: data.weights ? weights : undefined };
    }

    renderProgression() {
      this._stopProgression();
      this.progression = 1;
      this._progStart = Date.now();
      this._progTotal = Math.max(1, this._lastNumLinks || 1);
      this.progressionSpeed = ng19EngineClamp(0.5 * Math.sqrt(this._progTotal), 5, 100);
      this._inProg = true;
      this.render();
      this._inProg = false;
      this._progSeq = this._renderSeq;
      this._progTimer = setInterval(() => {
        if (this._renderSeq !== this._progSeq) { this._stopProgression(); return; }
        const elapsed = (Date.now() - this._progStart) / 1000;
        const target = 1 + Math.floor(this.progressionSpeed * elapsed);
        if (target > this._progTotal || target <= 0) { this._stopProgression(); return; }
        if (target !== this.progression) {
          this.progression = target;
          this._inProg = true;
          this.render();
          this._inProg = false;
          this._progSeq = this._renderSeq;
        }
      }, 100);
    }

    _stopProgression() {
      if (this._progTimer) { clearInterval(this._progTimer); this._progTimer = null; }
      this.progression = 0;
      this.progressionSpeed = 0;
    }

    onFileChanged(file) {
      if (!file || file.extension === "md") return;
      this.recomputeFile(file);
    }

    recomputeFile(file) {
      this.requestRender();
      if (this.queue && this.queue.running) this.requestUpdateSearch();
    }

    // ------------------------------------------------------------ node UI

    onNodeClick(evt, linktext, type) {
      if (type === "tag") { this._openTagSearch(linktext); return; }
      this.app.workspace.openLinkText(linktext, "", ng19Host().Keymap.isModEvent(evt));
    }

    onNodeRightClick(evt, linktext, type) {
      if (type === "tag") { this._openTagSearch(linktext); return; }
      const file = this.app.metadataCache.getFirstLinkpathDest(linktext, "");
      if (!file || !(evt instanceof MouseEvent)) return;
      const host = ng19Host();
      const T = (k) => __basaltHost.t.interface.menu[k] ? __basaltHost.t.interface.menu[k]() : k;
      const menu = new host.Menu();
      menu.addSections(["title", "open", "action", "info", "info.copy", "view", "view.linked", "system", "", "danger"]);
      menu.setSectionSubmenu("view.linked", { title: T("openLinkedView"), icon: "lucide-link" });
      menu.addItem((item) => item.setSection("title").setTitle(file.getShortName ? file.getShortName() : file.name).setDisabled(true));
      menu.addItem((item) => item
        .setSection("open")
        .setTitle(T("openInNewTab"))
        .setIcon("lucide-file-plus")
        .onClick(() => {
          const leaf = this.app.workspace.getLeaf(true);
          leaf.openFile(file);
        }));
      this.app.workspace.trigger("file-menu", menu, file, "graph-context-menu");
      menu.addItem((item) => item
        .setSection("danger")
        .setTitle(T("deleteFile"))
        .setIcon("lucide-trash-2")
        .setWarning()
        .onClick(() => this.app.fileManager.promptForDeletion(file)));
      menu.showAtMouseEvent(evt);
    }

    _openTagSearch(linktext) {
      const p = this.app.internalPlugins.getPluginById("global-search");
      if (p && p.enabled && p.instance && typeof p.instance.openGlobalSearch === "function") {
        p.instance.openGlobalSearch("tag:" + linktext);
      }
    }

    onNodeHover(evt, linktext, type) {
      if (!(evt instanceof MouseEvent)) return;
      if (!["", "focused", "attachment"].includes(type)) return;
      if (this.lastHoverLink === linktext && this.hoverPopover && this.hoverPopover.state !== env().VQ.Hidden) {
        if (this.hoverPopover.targetEl !== null) this.hoverPopover.targetEl = null;
        return;
      }
      this.lastHoverLink = linktext;
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: "graph",
        hoverParent: this,
        targetEl: null,
        linktext,
      });
    }

    onNodeUnhover() {
      if (this.hoverPopover) {
        this.hoverPopover.targetEl = null;
        if (this.hoverPopover.state !== env().VQ.Hidden && this.hoverPopover.transition) this.hoverPopover.transition();
      }
    }
  }

  ng19Graph.Engine = Ng19GraphEngine;
  return Ng19GraphEngine;
}
