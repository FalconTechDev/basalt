// Shared DOM/environment helpers for the g28 clean-room modules.
// Everything here is safe to call both inside the bundle (where env() resolves
// application-scope values) and inside a standalone module import in tests
// (where env() is empty and the fallbacks apply).
import { env } from "./env.js";

/** The window notices/modals should attach to (pop-out aware). */
export function ng28ActiveWindow() {
  return env().activeWindow || window;
}

/** The document matching the active window. */
export function ng28ActiveDocument() {
  return env().activeDocument || document;
}

/** Removes an element from its parent, if any. */
export function ng28Detach(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/** document.createElement with optional class and text. */
export function ng28El(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/** Obsidian's isShown() when present, a layout-based fallback otherwise. */
export function ng28IsShown(el) {
  if (!el) return false;
  if (typeof el.isShown === "function") return el.isShown();
  return !!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length));
}
