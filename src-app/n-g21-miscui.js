// n-g21-miscui.js — CanvasHelpModal (h3) + QuickActions (e4).
// Clean-room, spec g21 §2.6/§3.6.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { s13KeyNames } from "./s13-geom.js";
import { s13CanvasI18n } from "./s13-consts.js";

// =====================================================================================================================
// CanvasHelpModal — lists canvas mouse/keyboard shortcuts
// =====================================================================================================================

function ng21CanvasRows(host, zoomWheel) {
  const ci = s13CanvasI18n();
  const T = (fn, fb) => { try { return typeof fn === "function" ? fn() : fb; } catch (e) { return fb; } };
  const row = (label, combos) => ({ label, combos });
  const panScroll = zoomWheel ? [["Mod", "Scroll"], ["Space", "Scroll"]] : [["Shift", "Scroll"]];
  const zoomCombos = zoomWheel ? [["Shift", "Scroll"]] : [["Mod", "Scroll"], ["Space", "Scroll"]];
  const horizCombos = zoomWheel ? [["Mod", "Shift", "Scroll"], ["Shift", "Space", "Scroll"]] : [["Shift", "Scroll"]];
  const undo = T(env().gm.setting.mobileToolbar.optionUndo, "Undo");
  const redo = T(env().gm.setting.mobileToolbar.optionRedo, "Redo");
  return [
    row(T(ci.labelPan, "Pan"), [["Space", "Drag"], ...panScroll]),
    row(T(ci.labelPanHorizontal, "Pan sideways"), horizCombos),
    row(T(ci.labelZoom, "Zoom"), zoomCombos),
    row(T(ci.actionZoomToFit, "Zoom to fit"), [["Shift", "1"]]),
    row(T(ci.actionZoomToSelection, "Zoom to the selection"), [["Shift", "2"]]),
    row(T(ci.labelSelectAll, "Select everything"), [["Mod", "A"]]),
    row(T(ci.labelAddRemoveSelection, "Add to or take from the selection"), [["Shift", "Click"], ["Shift", "Drag to select"]]),
    row(T(ci.actionCreateWithSize, "Make a card of a chosen size"), [["Mod", "Drag to select"]]),
    row(T(ci.labelCloneCard, "Copy the card"), [[host.Platform.isMacOS ? "Alt" : "Ctrl", "Drag"]]),
    row(T(ci.labelConstrainMovementAxis, "Keep card movement on one axis"), [["Shift", "Drag"]]),
    row(T(ci.labelDisableDragSnapping, "Turn off snapping while dragging"), [[host.Platform.isMacOS ? "Ctrl" : "Alt"]]),
    row(T(ci.labelRemoveCard, "Delete the card"), [["Backspace"], ["Delete"]]),
    row(undo, [["Mod", "Z"]]),
    row(redo, [["Mod", "Y"], ["Mod", "Shift", "Z"]]),
  ];
}

export function ng21DefineS13CanvasHelpModal(host) {
  function CanvasHelpModal(view) {
    const self = host.Modal.call(this, view && view.app) || this;
    this.view = view;
    self.modalEl.addClass("mod-canvas-help");
    try {
      self.setTitle(s13CanvasI18n().labelCanvasHelp());
    } catch (e) { self.setTitle("Canvas guide"); }
    const wrap = self.contentEl.createDiv("canvas-help");
    let zoomWheel = false;
    try { zoomWheel = !!(view && view.plugin && view.plugin.options && view.plugin.options.defaultWheelBehavior === "zoom"); } catch (e) {}
    for (const r of ng21CanvasRows(host, zoomWheel)) {
      const instr = wrap.createDiv("canvas-instruction");
      instr.createDiv({ cls: "canvas-instruction-label", text: r.label });
      const desc = instr.createDiv("canvas-instruction-desc");
      r.combos.forEach((keys, i) => {
        if (i > 0) desc.createSpan({ text: " " });
        desc.createSpan({ cls: "setting-hotkey", text: s13KeyNames(keys, host) });
      });
    }
    return self;
  }
  inherit(CanvasHelpModal, host.Modal);
  return CanvasHelpModal;
}

// =====================================================================================================================
// QuickActions — registry bridging actions to OS quick-actions (Capacitor) + OBS_QUICK_ACTION*
// =====================================================================================================================

export function ng21DefineS13QuickActions(host) {
  function QuickActions(app, initialActions) {
    this.app = app;
    this.registeredActions = new Map();
    for (const action of initialActions || []) {
      if (action && action.id) this.registerQuickAction(action.id, action);
    }
    return this;
  }
  const p = QuickActions.prototype;

  p._mobileCapacitor = function () {
    return host.Platform.isMobileApp && host.capacitorApp ? host.capacitorApp : null;
  };

  p.load = function () {
    try {
      if (typeof window === "undefined") return;
      if (typeof window.OBS_QUICK_ACTION_LISTENER === "function") {
        try { window.removeEventListener("quick-action", window.OBS_QUICK_ACTION_LISTENER); } catch (e) {}
        window.OBS_QUICK_ACTION_LISTENER = null;
      }
      if (window.OBS_QUICK_ACTION) {
        const pending = window.OBS_QUICK_ACTION;
        try { delete window.OBS_QUICK_ACTION; } catch (e) { window.OBS_QUICK_ACTION = undefined; }
        const id = pending && (pending.id || pending.action) ? (pending.id || pending.action) : pending;
        this.fireAction(id);
      }
      const cap = this._mobileCapacitor();
      if (cap && typeof cap.addListener === "function") {
        cap.addListener("quickActionSelected", (event) => {
          if (event && event.id) this.fireAction(event.id);
        });
      }
    } catch (e) { console.error(e); }
  };

  p.init = function () { this.load(); };

  p.registerQuickAction = function (id, action) {
    if (!id || !action) return;
    this.registeredActions.set(id, {
      id,
      title: action.title,
      iconName: action.iconName || action.icon,
      description: action.description,
      callback: action.callback,
    });
    this.updateQuickActions();
  };

  p.unregisterQuickAction = function (id) {
    if (this.registeredActions.delete(id)) this.updateQuickActions();
  };

  p.fireAction = function (id) {
    if (!id) return;
    const action = this.registeredActions.get(id);
    if (action && typeof action.callback === "function") {
      try { action.callback(); } catch (e) { console.error(e); }
    }
  };

  p.updateQuickActions = function () {
    const cap = this._mobileCapacitor();
    if (!cap || typeof cap.setQuickActions !== "function") return;
    const actions = [];
    for (const action of this.registeredActions.values()) {
      actions.push({ id: action.id, title: action.title, iconName: action.iconName, description: action.description });
    }
    try { cap.setQuickActions({ actions }); } catch (e) { console.error(e); }
  };

  return QuickActions;
}
