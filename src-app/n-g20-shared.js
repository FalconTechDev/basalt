// g20 clean-room shared pieces: the `canvas` class registry the controller copies onto
// itself, the canvas/plugin i18n table accessors, frozen canvas constants and tiny helpers
// shared by the node/edge/selection/menu modules of this slice.
import { env } from "./env.js";

/** Registry populated by every canvas class factory; the controller copies its keys onto itself. */
export const canvas = {};

// ---- frozen constants (contract: plugins/themes read these exact values) --------------------

export const ng20EdgeEndRotation = { top: "180", bottom: "0", left: "90", right: "270" };
export const ng20EdgeEndNone = "none";
export const ng20EdgeEndArrow = "arrow";
export const ng20CanvasViewType = "canvas";
export const ng20CanvasExtension = "canvas";
export const ng20FileExplorerViewType = "file-explorer";
export const ng20DefaultDateFormat = "YYYY-MM-DD";
export const ng20RecoveryDefaults = { intervalMinutes: 5, keepDays: 7 };

// ---- lazy i18n table accessors --------------------------------------------------------------

export function ng20InterfaceStrings() { return env().gm.interface; }
export function ng20CanvasStrings() { return env().gm.plugins.canvas; }
export function ng20DailyNotesStrings() { return env().gm.plugins.dailyNotes; }
export function ng20FileExplorerStrings() { return env().gm.plugins.fileExplorer; }
export function ng20FileRecoveryStrings() { return env().gm.plugins.fileRecovery; }
export function ng20EditorStatusStrings() { return env().gm.plugins.editorStatus; }
export function ng20SyncStrings() { return env().gm.plugins.sync; }

// ---- small shared helpers ---------------------------------------------------------------------

/** True for a finite number (geometry inputs ignore anything else). */
export function ng20Finite(v) { return typeof v === "number" && isFinite(v); }

/** Rounds a possibly-missing numeric field, keeping the fallback when invalid. */
export function ng20RoundOr(v, fallback) {
  return ng20Finite(v) ? Math.round(v) : fallback;
}

const NG20_SIDES = ["top", "right", "bottom", "left"];
export function ng20Sides() { return NG20_SIDES; }

/** Deterministic tie order for direction picking: horizontal wins exact ties. */
export function ng20DominantAxis(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
}

/** Serialises canvas data the way the view expects: pretty JSON, tab indent. */
export function ng20Serialize(data, host) {
  return host.canvasSerialize(data);
}
