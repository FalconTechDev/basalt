// g34 clean-room: mermaid diagram rendering and post-processing
// (spec g34 part J, second half).
import { env } from "./env.js";
import { ng34LoadMermaidLib } from "./n-g34-lazy.js";
import { ng34CodeBlockText, ng34MermaidTextMap } from "./n-g34-render.js";

function ng34EscapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Rewrites mermaid-generated SVG internals: internal-link labels become
// real anchors, SVGAElement hrefs get baseVal, marker ids are prefixed.
export function ng34FixMermaidLinks(root, idPrefix) {
  if (typeof Element === "undefined" || !(root instanceof Element)) return;

  const labels = root.querySelectorAll("g.label foreignObject > div");
  for (const div of labels) {
    const label = div.textContent;
    if (!label) continue;
    const group = div.closest("[class*='internal-link']");
    if (!group) continue;
    div.textContent = "";
    const anchor = document.createElement("a");
    anchor.setAttribute("class", "internal-link");
    anchor.setAttribute("href", label);
    anchor.textContent = label;
    div.appendChild(anchor);
  }

  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof SVGAElement !== "undefined" && node instanceof SVGAElement) {
      const hrefAttr = node.getAttribute("href");
      if (hrefAttr !== null && node.href && !node.href.baseVal) node.href.baseVal = hrefAttr;
    }
    for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
  }

  const markers = root.querySelectorAll("marker[id]");
  for (const marker of markers) {
    const oldId = marker.id;
    if (!oldId) continue;
    const newId = idPrefix + "-" + oldId;
    marker.id = newId;
    const newUrl = "url(#" + newId + ")";
    const oldUrl = "url(#" + oldId + ")";
    const linked = root.querySelectorAll("[marker-start],[marker-end]");
    for (const el of linked) {
      for (const attr of ["marker-start", "marker-end"]) {
        if (el.getAttribute(attr) === oldUrl) el.setAttribute(attr, newUrl);
      }
    }
    const style = root.querySelector("style");
    if (style) {
      const re = new RegExp("#" + ng34EscapeRegExp(oldId) + "(?![\\w-])", "g");
      const next = style.innerHTML.replace(re, "#" + newId);
      if (next !== style.innerHTML) style.innerHTML = next;
    }
  }
}

// Renders one mermaid code block into a .mermaid div; on failure the code
// element stays in place showing the error text.
export async function ng34RenderMermaidDiagram(containerEl, codeEl) {
  const text = ng34CodeBlockText(codeEl);
  let width = codeEl.parentElement ? codeEl.parentElement.clientWidth : 0;
  if (!width) width = containerEl.clientWidth;
  if (!width && containerEl.win) width = containerEl.win.innerWidth;
  const id = "m" + env().cc(16);
  const holder = document.body.createDiv("mermaid");
  holder.style.width = width + "px";
  holder.style.visibility = "hidden";
  holder.style.position = "absolute";
  try {
    const result = await window.mermaid.render(id, text, holder);
    holder.detach();
    const rendered = env().createDiv("mermaid");
    rendered.innerHTML = result.svg;
    const parent = codeEl.parentElement || codeEl;
    parent.replaceWith(rendered);
    ng34MermaidTextMap.set(rendered, text);
    ng34FixMermaidLinks(rendered, id);
  } catch (err) {
    if (codeEl.doc) {
      const stale = codeEl.doc.getElementById("d" + id);
      if (stale) stale.remove();
    }
    holder.detach();
    console.error(err);
    if (codeEl.empty) codeEl.empty();
    else codeEl.textContent = "";
    codeEl.appendChild(document.createTextNode("Error parsing Mermaid diagram!\n\n" + ((err && (err.str || err.message)) || err)));
  }
}

// Loads mermaid, then renders every visible block now and defers hidden
// ones until they are inserted.
export async function ng34RenderMermaidBlocks(containerEl, codeEls) {
  await ng34LoadMermaidLib().promise;
  const pending = [];
  for (const codeEl of codeEls) {
    const render = () => ng34RenderMermaidDiagram(containerEl, codeEl);
    if (codeEl.isShown() || containerEl.isShown()) pending.push(render());
    else codeEl.onNodeInserted(render, true);
  }
  await Promise.all(pending);
}
