// g37 — canvas file view (clean-room). Factory: ng37CanvasView(host) -> TextFileView subclass.
import { env } from "./env.js";
import { inherit, methods } from "./inherit.js";

let ng37CanvasViewClass = null;

export function ng37CanvasView(host) {
  if (ng37CanvasViewClass) return ng37CanvasViewClass;

  function CanvasView(leaf, plugin) {
    const self = host.TextFileView.call(this, leaf) || this;
    self.icon = "lucide-layout-dashboard";
    self.isPlaintext = false;
    self.plugin = plugin;
    self.canvas = new (env().y5)(self);
    self.scope = new host.Scope(self.app.scope);

    const editable = (evt) => host.isEditableTarget(evt.targetNode);
    const bind = (prevent, fn) => (evt) => {
      if (editable(evt)) return undefined;
      if (prevent) evt.preventDefault();
      fn(evt);
      return prevent ? false : true;
    };
    const c = () => self.canvas;
    self.scope.register(["Mod"], "z", bind(true, () => c().undo()));
    const redo = bind(true, () => c().redo());
    self.scope.register(["Mod", "Shift"], "z", redo);
    self.scope.register(["Mod"], "y", redo);
    self.scope.register(["Mod"], "a", bind(false, () => c().selectAll()));
    self.scope.register(["Shift"], "1", bind(true, () => c().zoomToFit()));
    self.scope.register(["Shift"], "2", bind(true, () => c().zoomToSelection()));
    const dirs = [["ArrowLeft", "left"], ["ArrowRight", "right"], ["ArrowUp", "up"], ["ArrowDown", "down"]];
    for (const [key, dir] of dirs) {
      self.scope.register([], key, bind(true, (evt) => c().nudgeSelection(evt, dir)));
      self.scope.register(["Shift"], key, bind(true, (evt) => c().nudgeSelection(evt, dir)));
    }
    return self;
  }
  inherit(CanvasView, host.TextFileView);
  methods(CanvasView, {
    getViewType() { return "canvas"; },

    getState() {
      const state = host.TextFileView.prototype.getState.call(this);
      state.viewState = this.canvas ? this.canvas.getState() : {};
      return state;
    },

    async setState(state, result) {
      await host.TextFileView.prototype.setState.call(this, state, result);
      if (state && state.viewState && this.canvas) this.canvas.setState(state.viewState);
    },

    setEphemeralState(state) {
      host.TextFileView.prototype.setEphemeralState.call(this, state);
      if (!state || !this.canvas) return;
      if (state.focus && this.canvas.wrapperEl && typeof this.canvas.wrapperEl.focus === "function") {
        this.canvas.wrapperEl.focus({ preventScroll: true });
      }
      if (state.match) this._applyMatch(state.match);
    },

    _applyMatch(match) {
      const canvas = this.canvas;
      try {
        const node = typeof canvas.getNode === "function" ? canvas.getNode(match.nodeId)
          : (canvas.nodes && canvas.nodes[match.nodeId]) || null;
        if (!node) return;
        if (typeof canvas.selectNode === "function") canvas.selectNode(node);
        else if (typeof node.select === "function") node.select();
        const bbox = typeof node.getBBox === "function" ? node.getBBox()
          : (typeof canvas.getNodeBBox === "function" ? canvas.getNodeBBox(node) : null);
        if (bbox && typeof canvas.panTo === "function") canvas.panTo(bbox);
        if (match.content != null && node.type === "text" && node.renderer && node.renderer.embed) {
          const lines = String(node.text || "").split("\n");
          let offset = 0;
          for (const line of lines) {
            const at = line.indexOf(String(match.content));
            if (at !== -1) { offset = at; break; }
            offset += line.length + 1;
          }
          const renderer = node.renderer;
          setTimeout(() => {
            if (typeof renderer.scrollTo === "function") renderer.scrollTo(offset);
            if (typeof renderer.highlight === "function") renderer.highlight(offset);
          }, 0);
        }
      } catch (err) { /* match application is best-effort */ }
    },

    onResize() { if (this.canvas) this.canvas.onResize(); },

    getViewData() {
      return host.canvasSerialize(this.canvas ? this.canvas.getData() : { nodes: [], edges: [] });
    },

    setViewData(data, clear) {
      if (clear && this.canvas) this.canvas.clear();
      if (data) {
        this.canvas.setData(JSON.parse(data));
        if (clear) {
          if (typeof this.canvas.zoomToFit === "function") setTimeout(() => this.canvas.zoomToFit(), 0);
          this.onResize();
        }
      } else if (this.canvas) {
        if (typeof this.canvas.createPlaceholder === "function") this.canvas.createPlaceholder();
        if (typeof this.canvas.requestFrame === "function") this.canvas.requestFrame();
      }
      if (clear) {
        const local = this.getLocalData();
        if (local && typeof local.readonly === "boolean" && this.canvas) {
          this.canvas.setReadonly(local.readonly);
        }
      }
    },

    getLocalData() {
      const dm = this.plugin && this.plugin.localDataManager;
      const data = dm && typeof dm.load === "function" ? dm.load(this.file) : null;
      return data && typeof data === "object" ? data : {};
    },

    saveLocalData() {
      const dm = this.plugin && this.plugin.localDataManager;
      if (!dm || typeof dm.save !== "function" || !this.file) return;
      const readonly = !!(this.canvas && this.canvas.readonly);
      dm.save(this.file, readonly ? { readonly: true } : null);
    },

    clear() { if (this.canvas) this.canvas.clear(); },

    onOpen() {
      if (this.canvas && typeof this.canvas.load === "function") this.canvas.load();
      return host.TextFileView.prototype.onOpen.call(this);
    },

    onClose() {
      const done = host.TextFileView.prototype.onClose.call(this);
      if (this.canvas && typeof this.canvas.unload === "function") this.canvas.unload();
      return done;
    },

    handleCut(evt) { if (this.canvas) this.canvas.handleCut(evt); },
    handleCopy(evt) { if (this.canvas) this.canvas.handleCopy(evt); },
    handlePaste(evt) { if (this.canvas) this.canvas.handlePaste(evt); },

    onPaneMenu(menu, leaf) {
      host.TextFileView.prototype.onPaneMenu.call(this, menu, leaf);
      if (host.Platform && host.Platform.isDesktopApp && this.canvas) {
        menu.addItem((item) => item
          .setSection("action")
          .setTitle(env().gm.plugins.canvas.actionExportPng())
          .setIcon("lucide-image")
          .onClick(() => { if (typeof this.canvas.generateHDImage === "function") this.canvas.generateHDImage(); }));
      }
    },
  });
  ng37CanvasViewClass = CanvasView;
  return ng37CanvasViewClass;
}
