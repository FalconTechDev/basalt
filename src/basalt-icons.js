// Basalt's own icon set (stroke 1.75 on a 24 grid, square caps, miter joins, only 0/90/45 degree lines).
// The core bundle still draws Lucide icons; this module swaps the artwork of every `.svg-icon.lucide-<name>` it knows,
// now and for icons added later. Unknown names keep their Lucide drawing. Design: DESIGN.md section 9.
(() => {
  "use strict";
  const ICONS = {
  "folder-open": "M3 5H10L12 7H21V19H3Z",
  "file-text": "M5 3H15L19 7V21H5Z M15 3V7H19 M9 13H15 M9 17H13",
  "file-search": "M9 4H13L16 7V11L13 14H9L6 11V7Z M15 15L20 20",
  "history": "M9 3H15L21 9V15L15 21H9L3 15V9Z M12 7V12L15 15",
  "plug": "M9 2V8 M15 2V8 M6 8H18V12L14 16H10L6 12Z M12 16V22",
  "x": "M6 6L18 18 M18 6L6 18",
  "search": "M9 4H13L16 7V11L13 14H9L6 11V7Z M15 15L20 20",
  "plus": "M12 5V19 M5 12H19",
  "check": "M5 12L10 17L19 8",
  "menu": "M4 6H20 M4 12H20 M4 18H20",
  "chevron-right": "M9 5L16 12L9 19",
  "chevron-down": "M5 9L12 16L19 9",
  "arrow-left": "M20 12H5 M11 6L5 12L11 18",
  "arrow-up": "M12 20V5 M6 11L12 5L18 11",
  "settings": "M9 3H15L21 9V15L15 21H9L3 15V9Z M9 9H15V15H9Z",
  "pencil": "M4 20V16L16 4L20 8L8 20Z M13 7L17 11",
  "edit-3": "M4 20V16L16 4L20 8L8 20Z M13 7L17 11",
  "trash-2": "M4 6H20 M9 6V3H15V6 M6 6V21H18V6 M10 10V17 M14 10V17",
  "trash": "M4 6H20 M9 6V3H15V6 M6 6V21H18V6 M10 10V17 M14 10V17",
  "copy": "M9 9H20V20H9Z M15 9V4H4V15H9",
  "link": "M10 8H7L4 11V13L7 16H10 M14 8H17L20 11V13L17 16H14 M8 12H16",
  "bookmark": "M6 3H18V21L12 15L6 21Z",
  "pin": "M9 3H15V9L18 12V14H6V12L9 9Z M12 14V21",
  "image": "M3 4H21V20H3Z M3 17L8 12L12 16L16 12L21 17 M15 8H17",
  "lock": "M5 11H19V21H5Z M8 11V7L11 4H13L16 7V11",
  "eye": "M2 12L7 7H17L22 12L17 17H7Z M10 10H14V14H10Z",
  "eye-off": "M2 12L7 7H17L22 12L17 17H7Z M4 4L20 20",
  "info": "M9 3H15L21 9V15L15 21H9L3 15V9Z M12 11V17 M12 7V8",
  "alert-circle": "M12 2L22 12L12 22L2 12Z M12 7V13 M12 16V17",
  "alert-triangle": "M12 2L22 12L12 22L2 12Z M12 7V13 M12 16V17",
  "check-circle-2": "M9 3H15L21 9V15L15 21H9L3 15V9Z M8 12L11 15L16 9",
  "circle-check": "M9 3H15L21 9V15L15 21H9L3 15V9Z M8 12L11 15L16 9",
  "keyboard": "M2 6H22V18H2Z M6 10H8 M11 10H13 M16 10H18 M7 14H17",
  "git-fork": "M5 3H9V7H5Z M15 3H19V7H15Z M10 17H14V21H10Z M7 7V11H17V7 M12 11V17",
  "layout-dashboard": "M3 3H11V11H3Z M13 3H21V8H13Z M13 11H21V21H13Z M3 14H11V21H3Z",
  "list": "M9 6H21 M9 12H21 M9 18H21 M3 6H5 M3 12H5 M3 18H5",
  "filter": "M3 5H21 M6 12H18 M10 19H14",
  "sliders-horizontal": "M4 7H20 M4 17H20 M8 4V10 M16 14V20",
  "more-horizontal": "M5 12H6 M11 12H13 M18 12H19",
  "file": "M5 3H15L19 7V21H5Z M15 3V7H19",
  "file-plus": "M5 3H15L19 7V21H5Z M15 3V7H19 M12 11V17 M9 14H15",
  "folder": "M3 5H10L12 7H21V19H3Z",
  "globe-2": "M9 3H15L21 9V15L15 21H9L3 15V9Z M3 12H21 M12 3V21",
  "terminal": "M3 4H21V20H3Z M7 9L11 12L7 15 M13 15H17",
  "maximize-2": "M4 9V4H9 M15 4H20V9 M20 15V20H15 M9 20H4V15",
  "calendar": "M3 5H21V21H3Z M3 10H21 M8 3V7 M16 3V7",
  "tag": "M3 3H12L21 12L12 21L3 12Z M7 7H8",
  "clock": "M9 3H15L21 9V15L15 21H9L3 15V9Z M12 7V12L15 15",
  "rotate-cw": "M5 8H19 M15 4L19 8L15 12 M19 16H5 M9 12L5 16L9 20",
  "home": "M3 12L12 3L21 12 M5 10V21H19V10 M10 21V15H14V21",
  "sidebar": "M3 4H21V20H3Z M9 4V20",
  "split": "M3 4H21V20H3Z M12 4V20",
  "chevron-left": "M15 5L8 12L15 19",
  "arrow-right": "M4 12H19 M13 6L19 12L13 18",
  "arrow-down": "M12 4V19 M6 13L12 19L18 13",
  "chevron-up": "M5 15L12 8L19 15"
};
  const SVGNS = "http://www.w3.org/2000/svg";
  function swap(svg) {
    if (svg.__bsIcon) return;
    let name = null;
    for (const c of svg.classList) if (c.startsWith("lucide-") && ICONS[c.slice(7)]) { name = c.slice(7); break; }
    if (!name) return;
    svg.__bsIcon = true;
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-linecap", "square");
    svg.setAttribute("stroke-linejoin", "miter");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", ICONS[name]);
    svg.appendChild(p);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches("svg.svg-icon")) swap(root);
    root.querySelectorAll && root.querySelectorAll("svg.svg-icon").forEach(swap);
  }
  scan(document.documentElement);
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach(scan); }).observe(document.documentElement, { childList: true, subtree: true });
})();
