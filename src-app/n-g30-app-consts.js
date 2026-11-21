// g30 clean-room: shared application-scope constants (spec g30 part C).
// Pure data; the two trailing arrays are single shared mutable instances.

export const ng30PublishPaneMinWidth = 700;
export const ng30PublishPaneOffset = 36;
export const ng30BasaltCssName = "basalt.css";
export const ng30PublishCssName = "publish.css";
export const ng30PublishJsName = "publish.js";
export const ng30FaviconPattern = /^favicon-([0-9]+)(x[0-9]+)?.png$/i;
export const ng30BasesViewType = "bases";

export const ng30FilterCompareOps = ["==", "!=", "<", ">", "<=", ">="];
export const ng30FilterOrderOps = ["<", ">", "<=", ">="];

export const ng30WikiLinkChars = ["#", ":", "|", "^", "%%", "[[", "]]"].join(" ");

export const ng30PopoutStyleVars = ["--zoom-factor", "--keyboard-height"];
export const ng30PopoutBodyClasses = ["is-frameless", "is-focused", "is-fullscreen"];

export const ng30ForwardedEvents = [
  "fullscreenchange", "click", "contextmenu", "auxclick", "keydown", "keyup",
  "mousedown", "mouseup", "mousemove", "copy", "paste", "cut", "drag",
  "dragstart", "dragover", "dragend", "dragenter", "dragleave", "drop", "open-url",
];

export const ng30LinePrefix = /^[\s>]+/;

export const ng30UnboundEditorKeys = new Set([
  "Alt-ArrowUp", "Shift-Alt-ArrowUp", "Alt-ArrowDown", "Shift-Alt-ArrowDown",
  "Alt-l", "Alt-v", "Ctrl-m",
]);

export const ng30EditorExtensions = [];
export const ng30CmHistoryStore = [];
