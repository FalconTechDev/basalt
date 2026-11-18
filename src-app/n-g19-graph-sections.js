// g19 clean-room: collapsible graph control sections — filter (search +
// local-graph toggles), colour groups, display and force sliders. Sections
// extend the shared collapsible tree-item base (env().XL) and register
// option listeners so engine.getOptions/setOptions stay generic.
import { env } from "./env.js";
import { hslToRgb, rgbToInt, sliderCurve } from "./misc.js";
import {
  ng19GraphDisplayDefaults, ng19GraphForceDefaults,
  ng19GT, ng19TT, ng19Graph,
} from "./n-g19-graph-consts.js";
import { ng19GraphDefaults } from "./n-g19-graph-util.js";

const ng19Host = () => __basaltHost;

function ng19AddCls(el, ...cls) {
  if (!el) return;
  if (el.addClass) el.addClass(...cls);
  else for (const c of cls) el.classList.add(c);
}
/** Attach the app's search suggest popup to a text input, when available. */
function ng19AttachSuggest(app, inputEl) {
  const S = env().hJ;
  if (S && typeof S.attach === "function") {
    try { S.attach(app, inputEl, true); } catch (e) { /* suggest is optional */ }
  }
}

// ---------------------------------------------------------------- base section

/** Manifest factory: collapsible control-section base class. */
export function ng19GraphControlSection() {
  if (ng19Graph.ControlSection) return ng19Graph.ControlSection;
  const Base = env().XL;

  class Ng19GraphControlSection extends Base {
    constructor(engine, mod, title) {
      super();
      this.engine = engine;
      this.optionListeners = {};
      const e = env();
      if (!this.el) this.el = e.createDiv();
      if (!this.selfEl) {
        this.selfEl = this.el.createDiv("tree-item-self");
        this.innerEl = this.selfEl.createDiv("tree-item-inner");
      }
      if (!this.childrenEl) this.childrenEl = this.el.createDiv("tree-item-children");
      ng19AddCls(this.el, "graph-control-section", "mod-" + mod);
      if (this.setClickable) this.setClickable(true);
      if (this.setCollapsible) this.setCollapsible(true);
      const header = this.selfEl.createEl("header", { cls: "graph-control-section-header" });
      if (header.setText) header.setText(title);
      else header.textContent = title;
      this._listen("collapse-" + mod, {
        set: (v) => { if (this.setCollapsed) this.setCollapsed(!!v, false); },
        get: () => this.collapsed === true,
      });
      if (this.setCollapsed) this.setCollapsed(true, false);
      else { this.collapsed = true; ng19AddCls(this.el, "is-collapsed"); }
    }

    onSelfClick() {
      if (this.toggleCollapsed) this.toggleCollapsed();
    }

    _listen(name, listener) { this.optionListeners[name] = listener; }

    setOptions(options) {
      if (!options || typeof options !== "object") return;
      for (const key of Object.keys(options)) {
        const l = this.optionListeners[key];
        if (l && l.set) l.set(options[key]);
      }
    }

    getOptions(out) {
      for (const key of Object.keys(this.optionListeners)) {
        const l = this.optionListeners[key];
        if (l && l.get) {
          const v = l.get();
          if (v !== undefined) out[key] = v;
        }
      }
    }
  }

  ng19Graph.ControlSection = Ng19GraphControlSection;
  return Ng19GraphControlSection;
}

// ------------------------------------------------------------- shared helpers

/** Registers {set,get} for `opt` backed by engine.options plus a UI sync. */
function ng19Option(section, opt, applyUI) {
  section._listen(opt, {
    set: (v) => {
      section.engine.options[opt] = v;
      if (applyUI) applyUI(v);
    },
    get: () => section.engine.options[opt],
  });
}

function ng19MakeSetting(section, cls) {
  const host = ng19Host();
  const st = new host.Setting(section.childrenEl);
  if (cls) st.setClass(cls);
  return st;
}

// ------------------------------------------------------------- filter section

/** Manifest factory: filter section (search box + graph-shape toggles). */
export function ng19GraphFilterSection() {
  if (ng19Graph.FilterSection) return ng19Graph.FilterSection;
  const Base = ng19GraphControlSection();

  class Ng19GraphFilterSection extends Base {
    constructor(engine) {
      super(engine, "filter", ng19GT("labelFilters"));
      const host = ng19Host();
      const app = engine.app;
      const isLocal = !!engine.isLocalGraph;

      // --- search row -----------------------------------------------------
      const searchSetting = ng19MakeSetting(this, "mod-search-setting");
      this.searchSetting = searchSetting.settingEl;
      let searchComp = null;
      searchSetting
        .setName("")
        .addSearch((search) => {
          searchComp = search;
          this.search = search;
          search.setPlaceholder(ng19GT("promptFilterNodes"));
          search.setValue("");
          search.onChange((v) => {
            engine.options.search = v;
            engine.requestUpdateSearch();
          });
          const input = search.inputEl;
          input.addEventListener("keydown", (e) => {
            if (!e.isComposing && e.key === "Enter") {
              e.preventDefault();
              engine.updateSearch();
            }
          });
          if (search.clearButtonEl) {
            host.setTooltip(search.clearButtonEl, ng19TT("search", "tooltipClearSearch"));
          }
          ng19AttachSuggest(app, input);
        });
      ng19Option(this, "search", (v) => { if (searchComp) searchComp.setValue(String(v || "")); });

      // --- local-graph-only controls (depth first) ------------------------
      if (isLocal) {
        let depthSlider = null;
        ng19MakeSetting(this, "mod-slider")
          .setClass("mod-local-jumps")
          .setName(ng19GT("optionDepth"))
          .setDesc(ng19GT("optionDepthDescription"))
          .addSlider((sl) => {
            depthSlider = sl;
            sl.setLimits(1, 5, 1).setValue(engine.options.localJumps).setDynamicTooltip().setInstant(true);
            sl.onChange((v) => {
              engine.options.localJumps = v | 0;
              engine.render();
              engine.onOptionsChange();
            });
          });
        ng19Option(this, "localJumps", (v) => { if (depthSlider) depthSlider.setValue(v | 0); });

        const localToggles = [
          ["localBacklinks", "optionBacklinks", "optionBacklinksDescription"],
          ["localForelinks", "optionForelinks", "optionForelinksDescription"],
          ["localInterlinks", "optionNeighborLinks", "optionNeighborLinksDescription"],
        ];
        for (const [opt, nameKey, descKey] of localToggles) {
          this._addToggle(opt, nameKey, descKey);
        }
      }

      // --- shared toggles ---------------------------------------------------
      const shared = [
        ["showTags", "optionShowTags", "optionShowTagsDescription"],
        ["showAttachments", "optionShowAttachments", "optionShowAttachmentsDescription"],
        ["hideUnresolved", "optionShowExistingFilesOnly", "optionShowExistingFilesOnlyDescription"],
      ];
      if (!isLocal) shared.push(["showOrphans", "optionShowOrphans", "optionShowOrphansDescription"]);
      for (const [opt, nameKey, descKey] of shared) {
        this._addToggle(opt, nameKey, descKey);
      }
    }

    _addToggle(opt, nameKey, descKey) {
      const engine = this.engine;
      let comp = null;
      ng19MakeSetting(this)
        .setName(ng19GT(nameKey))
        .setDesc(ng19GT(descKey))
        .addToggle((t) => {
          comp = t;
          t.setValue(!!engine.options[opt]);
          t.onChange((v) => {
            if (engine.options[opt] === v) return;
            engine.options[opt] = v;
            engine.render();
            engine.onOptionsChange();
          });
        });
      ng19Option(this, opt, (v) => { if (comp) comp.setValue(!!v); });
    }

    // ---- search-state helpers ---------------------------------------------
    startSearch() {
      if (this.searchSetting) ng19AddCls(this.searchSetting, "is-loading");
    }
    stopSearch() {
      if (this.searchSetting) {
        if (this.searchSetting.classList) this.searchSetting.classList.remove("is-loading");
        else this.searchSetting.removeClass && this.searchSetting.removeClass("is-loading");
      }
    }

    setDefaultOptions() {
      const o = this.engine.options;
      for (const k of Object.keys(ng19GraphDefaults)) {
        if (k !== "localFile") o[k] = ng19GraphDefaults[k];
      }
      this.setOptions(o);
    }
  }

  ng19Graph.FilterSection = Ng19GraphFilterSection;
  return Ng19GraphFilterSection;
}

// ----------------------------------------------------------- colour group row

function ng19IsDark() {
  try { return document.body.classList.contains("theme-dark"); } catch (e) { return true; }
}

function ng19NewGroupColor(count) {
  const rgb = hslToRgb({ h: 40 * count, s: ng19IsDark() ? 70 : 60, l: 60 });
  return { a: 1, rgb: rgbToInt(rgb) };
}

// ------------------------------------------------------------- groups section

/** Manifest factory: colour-group section with draggable query rows. */
export function ng19GraphColorSection() {
  if (ng19Graph.ColorSection) return ng19Graph.ColorSection;
  const Base = ng19GraphControlSection();

  class Ng19GraphColorSection extends Base {
    constructor(engine) {
      super(engine, "color-groups", ng19GT("labelGroups"));
      this.groups = [];
      const host = ng19Host();
      const container = this.childrenEl.createDiv("graph-color-groups-container");
      this.groupsContainer = container;
      const btnWrap = this.childrenEl.createDiv("graph-color-button-container");
      const btn = btnWrap.createEl("button", { cls: "mod-cta" });
      btn.setText ? btn.setText(ng19GT("buttonNewGroup")) : btn.textContent = ng19GT("buttonNewGroup");
      btn.addEventListener("click", () => {
        const color = ng19NewGroupColor(this.groups.length);
        this._addGroupRow("", color);
        this.engine.updateSearch();
        this.engine.onOptionsChange();
      });
      ng19Option(this, "colorGroups", (v) => {
        this.setColorQueries(Array.isArray(v) ? v : []);
        engine.requestUpdateSearch();
      });
    }

    // -- row construction ----------------------------------------------------
    _addGroupRow(query, color) {
      const host = ng19Host();
      const engine = this.engine;
      const row = this.groupsContainer.createDiv("graph-color-group");
      const group = { query: query || "", color: color || { a: 1, rgb: 0 }, row };

      const queryWrap = row.createDiv();
      const input = new host.TextComponent(queryWrap);
      input.setPlaceholder(ng19GT("placeholderEnterQuery"));
      input.setValue(group.query);
      input.onChange((v) => {
        group.query = v;
        engine.requestUpdateSearch();
      });
      ng19AttachSuggest(engine.app, input.inputEl);
      group.queryInput = input;

      const picker = new host.ColorComponent(row);
      picker.setValueInt(group.color.rgb);
      picker.onChange(() => { engine.updateSearch(); });
      host.setTooltip(picker.colorPickerEl, ng19GT("tooltipClickToChangeDragToReorder"));
      picker.colorPickerEl.addEventListener("mousedown", (evt) => this.onDragOption(evt, group));
      group.picker = picker;

      const del = row.createDiv("clickable-icon");
      host.setIcon(del, "lucide-x");
      host.setTooltip(del, ng19GT("tooltipDeleteGraph"));
      del.addEventListener("click", () => {
        const i = this.groups.indexOf(group);
        if (i >= 0) this.groups.splice(i, 1);
        row.remove ? row.remove() : row.detach();
        this.engine.updateSearch();
        this.engine.onOptionsChange();
      });

      this.groups.push(group);
      return group;
    }

    setColorQueries(entries) {
      this.groupsContainer.empty ? this.groupsContainer.empty() : (this.groupsContainer.innerHTML = "");
      this.groups = [];
      for (const e of entries || []) {
        this._addGroupRow(e && e.query ? e.query : "", e && e.color ? { a: e.color.a == null ? 1 : e.color.a, rgb: e.color.rgb | 0 } : ng19NewGroupColor(this.groups.length));
      }
    }

    getColoredQueries() {
      return this.groups.map((g) => ({
        query: g.queryInput ? g.queryInput.getValue() : g.query,
        color: { a: 1, rgb: g.picker ? g.picker.getValueInt() : (g.color.rgb | 0) },
      }));
    }

    // -- drag reorder ----------------------------------------------------------
    getDropIndex(evt) {
      const rows = Array.from(this.groupsContainer.querySelectorAll(".graph-color-group"));
      let idx = 0;
      for (const row of rows) {
        if (row.classList && row.classList.contains("drag-ghost")) continue;
        const r = row.getBoundingClientRect();
        if (evt.clientY > r.top + r.height / 2) idx++;
      }
      return idx;
    }

    _slideRows(dropIndex, dragged) {
      // preview order: groups minus dragged, dragged inserted at dropIndex
      const rest = this.groups.filter((g) => g !== dragged);
      const preview = rest.slice();
      preview.splice(Math.min(dropIndex, preview.length), 0, dragged);
      const h = dragged.row.offsetHeight || 30;
      this.groups.forEach((g, cur) => {
        const target = preview.indexOf(g);
        const dy = (target - cur) * h;
        g.row.style.position = "relative";
        g.row.style.top = dy ? dy + "px" : "";
        g.row.style.zIndex = dy ? "1" : "";
      });
    }

    _clearSlide() {
      for (const g of this.groups) {
        g.row.style.position = "";
        g.row.style.top = "";
        g.row.style.zIndex = "";
      }
    }

    onDragOption(evt, group) {
      if (!evt || evt.button !== 0) return;
      const startX = evt.clientX, startY = evt.clientY;
      let ghost = null, dragging = false, dropIndex = -1;
      const self = this;
      const onMove = (e) => {
        if (!dragging) {
          if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) return;
          dragging = true;
          ghost = group.row.cloneNode(true);
          ng19AddCls(ghost, "drag-ghost");
          ghost.style.position = "fixed";
          ghost.style.width = group.row.offsetWidth + "px";
          ghost.style.pointerEvents = "none";
          ghost.style.zIndex = "1000";
          ghost.style.margin = "0";
          document.body.appendChild(ghost);
          document.body.classList.add("is-grabbing");
          if (self.childrenEl) self.childrenEl.classList.add("is-grabbing");
          group.row.style.opacity = "0.4";
        }
        ghost.style.left = e.clientX + "px";
        ghost.style.top = e.clientY + "px";
        const idx = self.getDropIndex(e);
        if (idx !== dropIndex) { dropIndex = idx; self._slideRows(idx, group); }
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        if (dragging && ghost) {
          ghost.remove ? ghost.remove() : ghost.detach();
          document.body.classList.remove("is-grabbing");
          if (self.childrenEl) self.childrenEl.classList.remove("is-grabbing");
          group.row.style.opacity = "";
          self._clearSlide();
          // splice the group into its drop position
          const from = self.groups.indexOf(group);
          if (from >= 0) {
            self.groups.splice(from, 1);
            let to = dropIndex;
            if (from < to) to--;
            self.groups.splice(Math.max(0, Math.min(to, self.groups.length)), 0, group);
            // rebuild DOM order to match
            for (const g of self.groups) self.groupsContainer.appendChild(g.row);
          }
          self.setColorQueries(self.getColoredQueries());
          self.engine.updateSearch();
          self.engine.onOptionsChange();
        }
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    }
  }

  ng19Graph.ColorSection = Ng19GraphColorSection;
  return Ng19GraphColorSection;
}

// ------------------------------------------------------------- display section

/** Manifest factory: display-options section (arrows, fades, sizes). */
export function ng19GraphDisplaySection() {
  if (ng19Graph.DisplaySection) return ng19Graph.DisplaySection;
  const Base = ng19GraphControlSection();

  class Ng19GraphDisplaySection extends Base {
    constructor(engine) {
      super(engine, "display", ng19GT("labelDisplay"));
      const renderer = engine.renderer;
      let arrowToggle = null;

      ng19MakeSetting(this)
        .setName(ng19GT("optionShowArrows"))
        .setDesc(ng19GT("optionShowArrowsDescription"))
        .addToggle((t) => {
          arrowToggle = t;
          t.setValue(!!engine.options.showArrow);
          t.onChange((v) => {
            if (engine.options.showArrow === v) return;
            engine.options.showArrow = v;
            if (renderer) renderer.setRenderOptions({ showArrow: v });
            engine.onOptionsChange();
          });
        });
      ng19Option(this, "showArrow", (v) => {
        if (arrowToggle) arrowToggle.setValue(!!v);
        if (renderer) renderer.setRenderOptions({ showArrow: !!v });
      });

      const sliders = [
        ["textFadeMultiplier", -3, 3, 0.1, "optionTextFade", null],
        ["nodeSizeMultiplier", 0.1, 5, "any", "optionNodeSize", null],
        ["lineSizeMultiplier", 0.1, 5, "any", "optionLinkThickness", null],
      ];
      for (const [opt, min, max, step, nameKey] of sliders) {
        if (engine.options[opt] === undefined) engine.options[opt] = ng19GraphDisplayDefaults[opt];
        let comp = null;
        ng19MakeSetting(this, "mod-slider")
          .setName(ng19GT(nameKey))
          .addSlider((sl) => {
            comp = sl;
            sl.setLimits(min, max, step).setValue(engine.options[opt]).setDynamicTooltip().setInstant(true);
            sl.onChange((v) => {
              if (engine.options[opt] === v) return;
              engine.options[opt] = v;
              if (renderer) renderer.setRenderOptions({ [opt]: v });
              engine.onOptionsChange();
            });
          });
        ng19Option(this, opt, (v) => {
          if (comp) comp.setValue(v);
          if (renderer) renderer.setRenderOptions({ [opt]: v });
        });
      }

      // timelapse CTA — global graph only
      if (!engine.isLocalGraph) {
        ng19MakeSetting(this)
          .setName(ng19GT("actionTimelapse"))
          .setDesc(ng19GT("tooltipStartTimelapseAnimation"))
          .addButton((b) => {
            b.setButtonText(ng19GT("buttonAnimateTimelapse"));
            b.onClick(() => { if (engine.renderProgression) engine.renderProgression(); });
          });
      }
    }

    setDefaultOptions() {
      const o = this.engine.options;
      for (const k of Object.keys(ng19GraphDisplayDefaults)) o[k] = ng19GraphDisplayDefaults[k];
      this.setOptions(o);
    }
  }

  ng19Graph.DisplaySection = Ng19GraphDisplaySection;
  return Ng19GraphDisplaySection;
}

// --------------------------------------------------------------- forces section

/** Manifest factory: force-layout sliders (positions stored, real values posted). */
export function ng19GraphForceSection() {
  if (ng19Graph.ForceSection) return ng19Graph.ForceSection;
  const Base = ng19GraphControlSection();

  const NG19_FORCE_SLIDERS = [
    // [optionKey, min, max, step, nameKey, toEngine(pos)->forcesPatch]
    ["centerStrength", 0, 1, "any", "optionCenterForce", (v) => ({ centerStrength: sliderCurve(v, 0.01) })],
    ["repelStrength", 0, 20, "any", "optionRepelForce", (v) => ({ repelStrength: v * v * v })],
    ["linkStrength", 0, 1, "any", "optionLinkForce", (v) => ({ linkStrength: sliderCurve(v, 0.01) })],
    ["linkDistance", 30, 500, 1, "optionLinkDistance", (v) => ({ linkDistance: v })],
  ];

  class Ng19GraphForceSection extends Base {
    constructor(engine) {
      super(engine, "forces", ng19GT("labelForces"));
      const renderer = engine.renderer;
      for (const [opt, min, max, step, nameKey, toEngine] of NG19_FORCE_SLIDERS) {
        if (engine.options[opt] === undefined) engine.options[opt] = ng19GraphForceDefaults[opt];
        let comp = null;
        ng19MakeSetting(this, "mod-slider")
          .setName(ng19GT(nameKey))
          .addSlider((sl) => {
            comp = sl;
            sl.setLimits(min, max, step).setValue(engine.options[opt]).setDynamicTooltip().setInstant(true);
            sl.onChange((v) => {
              if (engine.options[opt] === v) return;
              engine.options[opt] = v;
              if (renderer) renderer.setForces(toEngine(v));
              engine.onOptionsChange();
            });
          });
        ng19Option(this, opt, (v) => {
          if (comp) comp.setValue(v);
          if (renderer) renderer.setForces(toEngine(v));
        });
      }
    }

    setDefaultOptions() {
      const o = this.engine.options;
      for (const k of Object.keys(ng19GraphForceDefaults)) o[k] = ng19GraphForceDefaults[k];
      this.setOptions(o);
    }
  }

  ng19Graph.ForceSection = Ng19GraphForceSection;
  return Ng19GraphForceSection;
}
