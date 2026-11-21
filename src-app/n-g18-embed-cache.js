import { env } from "./env.js";
import { randomHex } from "./misc.js";
import { escapeRegExp } from "./metadata-helpers.js";
import { ng18MermaidLoader } from "./n-g18-loaders.js";

// g18 / s07-embeds.js — dedupe caches, "find the rendered twin" helpers and
// the mermaid post-processor. All host/env access stays lazy.

export function ng18NewEmbedCache() {
  if (typeof WeakMap === "function") return new WeakMap();
  const store = new Map();
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    has: (key) => store.has(key),
    delete: (key) => store.delete(key),
  };
}

export function ng18MermaidCodeText(el) {
  const cache = env().Xz;
  let text = cache.get(el);
  if (text === undefined) {
    text = el.getText();
    if (text.endsWith("\n")) text = text.slice(0, -1);
    cache.set(el, text);
  }
  return text;
}

function ng18EachSectionRoot(sections) {
  const roots = [];
  for (const section of sections || []) roots.push(section && section.el ? section.el : section);
  return roots;
}

export function ng18MermaidElementFor(sections, text) {
  for (const root of ng18EachSectionRoot(sections)) {
    if (!root || !root.findAll) continue;
    for (const el of root.findAll(".mermaid")) {
      if (ng18MermaidCodeText(el) === text) return el;
    }
  }
  return null;
}

export function ng18HighlightedLang(el) {
  const classes = (el.className || "").split(" ");
  for (const cls of classes) {
    if (cls.startsWith("language-")) return cls;
  }
  return undefined;
}

export function ng18MathElementFor(sections, text, isBlock) {
  const cache = env().eq;
  for (const root of ng18EachSectionRoot(sections)) {
    if (!root || !root.findAll) continue;
    for (const el of root.findAll(".math.is-loaded")) {
      if (cache.get(el) === text && el.classList.contains("math-block") === isBlock) return el;
    }
  }
  return null;
}

export function ng18AttrsMatch(source, target, names) {
  for (const name of names) {
    if (source.getAttr(name) !== target.getAttr(name)) return false;
  }
  return true;
}

export function ng18InternalEmbedFor(sections, source) {
  for (const root of ng18EachSectionRoot(sections)) {
    if (!root || !root.findAll) continue;
    for (const el of root.findAll(".internal-embed.is-loaded")) {
      if (ng18AttrsMatch(source, el, ["src", "width", "height", "alt"])) return el;
    }
  }
  return null;
}

export function ng18HighlightedCodeFor(sections, lang, text) {
  const cache = env().Xz;
  for (const root of ng18EachSectionRoot(sections)) {
    if (!root || !root.findAll) continue;
    for (const el of root.findAll('code[class*="language-"].is-loaded')) {
      if (cache.get(el) === text && ng18HighlightedLang(el) === lang) return el;
    }
  }
  return null;
}

export function ng18ImageFor(sections, url, source) {
  for (const root of ng18EachSectionRoot(sections)) {
    if (!root || !root.findAll) continue;
    for (const img of root.findAll("img")) {
      if (!(img instanceof HTMLImageElement)) continue;
      if (!img.complete || img.src !== url) continue;
      for (const name of ["width", "height", "alt"]) {
        img.setAttr(name, source.getAttr(name));
      }
      return img;
    }
  }
  return null;
}

export function ng18LinkHrefFor(el, container) {
  if (!env().Gz.belongsToMe(el, container)) return null;
  return el.getAttr("data-href") || el.getAttr("href");
}

// --- mermaid rendering ----------------------------------------------------

export async function ng18RenderMermaidDiagrams(contentEl, codeEls) {
  await ng18MermaidLoader().promise;
  const pending = [];
  for (const code of codeEls) {
    if (code.isShown() || contentEl.isShown()) {
      pending.push(ng18RenderMermaidDiagram(contentEl, code));
    } else {
      code.onNodeInserted(() => {
        ng18RenderMermaidDiagram(contentEl, code);
      }, true);
    }
  }
  await Promise.all(pending);
}

function ng18MarkerIdPattern(markerId) {
  return new RegExp(`#${escapeRegExp(markerId)}(?![\\w-])`, "g");
}

export async function ng18RenderMermaidDiagram(container, codeEl) {
  const text = ng18MermaidCodeText(codeEl);
  const width =
    (codeEl.parentElement && codeEl.parentElement.clientWidth) ||
    container.clientWidth ||
    (container.win && container.win.innerWidth) ||
    0;
  const id = "m" + randomHex(16);
  const measurer = document.body.createDiv({ cls: "mermaid" });
  measurer.style.visibility = "hidden";
  measurer.style.position = "absolute";
  measurer.style.width = width + "px";
  try {
    const rendered = await window.mermaid.render(id, text, measurer);
    const svg = rendered && rendered.svg;
    measurer.detach();

    const holder = document.body.createDiv({ cls: "mermaid" });
    holder.innerHTML = svg;
    const parent = codeEl.parentElement;
    if (parent) parent.replaceWith(holder);
    else holder.detach();
    env().Xz.set(holder, text);

    if (holder instanceof Element) ng18FixupMermaidSvg(holder, id);
  } catch (err) {
    measurer.detach();
    const stale = document.getElementById("d" + id);
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    console.error(err);
    codeEl.empty();
    codeEl.appendText("Error parsing Mermaid diagram!\n\n" + (err.str || err.message));
  }
}

function ng18FixupMermaidSvg(holder, id) {
  for (const div of holder.findAll('[class*="internal-link"] > g.label foreignObject > div')) {
    const label = div.getText();
    if (!label) continue;
    div.empty();
    const link = div.createEl("a", { cls: "internal-link" });
    link.setAttr("href", label);
    link.setText(label);
  }

  for (const el of holder.findAll("*")) {
    if (!(el instanceof SVGAElement)) continue;
    const href = el.href;
    if (href && href.baseVal === "") {
      const attr = el.getAttr("href");
      if (attr) href.baseVal = attr;
    }
  }

  const styleEl = holder.find("style");
  if (!styleEl) return;
  const markers = holder.findAll("marker");
  if (!markers.length) return;
  const markerTargets = holder.findAll("[marker-start],[marker-end]");
  let styleText = styleEl.getText();
  let changed = false;
  for (const marker of markers) {
    const markerId = marker.getAttr("id");
    if (!markerId) continue;
    const renamed = id + "-" + markerId;
    marker.setAttr("id", renamed);
    for (const el of markerTargets) {
      for (const name of ["marker-start", "marker-end"]) {
        const value = el.getAttr(name);
        if (value && value.indexOf("url(#" + markerId + ")") !== -1) {
          el.setAttr(name, value.split("url(#" + markerId + ")").join("url(#" + renamed + ")"));
        }
      }
    }
    const next = styleText.replace(ng18MarkerIdPattern(markerId), "#" + renamed);
    if (next !== styleText) {
      styleText = next;
      changed = true;
    }
  }
  if (changed) styleEl.setText(styleText);
}
