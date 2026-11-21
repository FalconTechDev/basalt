// g38 clean-room: titlebar chrome — Basalt logo button + menu IPC (spec g38 Part 7).
// Runs once per window before the workspace exists; no-op without frameDom.
// On macOS the native traffic lights own the spot, so only updateStatus() runs.
import { env } from "./env.js";

// Wireframe basalt mark: hexagonal plinth outline with column ticks (asset path).
const ng38WireframePath =
  "M256 24 L476 140 L476 372 L256 488 L36 372 L36 140 Z " +
  "M256 88 L420 180 L420 332 L256 424 L92 332 L92 180 Z " +
  "M176 224 L176 300 M256 208 L256 316 M336 224 L336 300 " +
  "M128 252 L204 290 M384 252 L308 290 M128 348 L204 310 M384 348 L308 310 " +
  "M160 372 L256 420 M352 372 L256 420";

const ng38SvgNS = "http://www.w3.org/2000/svg";

function ng38Svg(doc, cls) {
  const svg = doc.createElementNS(ng38SvgNS, "svg");
  svg.setAttribute("viewBox", "0 0 512 512");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("class", cls);
  return svg;
}

export function ng38WindowChrome(win) {
  const frameDom = win.frameDom;
  if (!frameDom) return;
  const doc = win.document;
  const frag = doc.createDocumentFragment();
  if (!env().Yl.isMacOS) {
    const btn = typeof frag.createDiv === "function"
      ? frag.createDiv("titlebar-button mod-logo")
      : (() => {
        const el = doc.createElement("div");
        el.className = "titlebar-button mod-logo";
        frag.appendChild(el);
        return el;
      })();
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    const sendMenu = () => win.electron.ipcRenderer.send("render-menu");
    btn.addEventListener("click", sendMenu);
    btn.addEventListener("contextmenu", sendMenu);

    const full = ng38Svg(doc, "logo-full");
    const img = doc.createElementNS(ng38SvgNS, "image");
    img.setAttribute("href", "basalt-titlebar.png");
    img.setAttribute("x", "82");
    img.setAttribute("y", "0");
    img.setAttribute("width", "348");
    img.setAttribute("height", "512");
    full.appendChild(img);
    btn.appendChild(full);

    const wire = ng38Svg(doc, "logo-wireframe");
    wire.setAttribute("fill", "none");
    wire.setAttribute("stroke", "currentColor");
    wire.setAttribute("stroke-width", "32");
    wire.setAttribute("stroke-linecap", "round");
    wire.setAttribute("stroke-linejoin", "round");
    const path = doc.createElementNS(ng38SvgNS, "path");
    path.setAttribute("d", ng38WireframePath);
    wire.appendChild(path);
    btn.appendChild(wire);
  }
  frameDom.leftButtonContainerEl.appendChild(frag);
  frameDom.updateStatus();
}

// Test-facing alias for the legacy module contract.
export { ng38WindowChrome as s36WindowChrome };
