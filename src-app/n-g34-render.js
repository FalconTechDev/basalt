// g34 clean-room: markdown-preview post-processing — element/source maps,
// section parsing, callout icon, link href extraction, mermaid rendering
// (spec g34 part J, first half).
import { env } from "./env.js";

// Element -> source text stores for the preview recycler.
export const ng34MermaidTextMap = new WeakMap();
export const ng34MathTextMap = new WeakMap();

// Source text of a code/math element, cached per element; one trailing
// newline is stripped.
export function ng34CodeBlockText(el) {
  let text = ng34MermaidTextMap.get(el);
  if (text === undefined) {
    text = el.getText();
    if (text.charAt(text.length - 1) === "\n") text = text.slice(0, -1);
    ng34MermaidTextMap.set(el, text);
  }
  return text;
}

// First "language-*" class with the prefix intact; undefined when absent.
export function ng34CodeLanguage(el) {
  const classes = String(el.className || "").split(/\s+/);
  for (const cls of classes) {
    if (cls.indexOf("language-") === 0) return cls;
  }
  return undefined;
}

function ng34EachSection(sections, selector, visit) {
  for (const section of sections) {
    const found = section.el.findAll(selector);
    for (let i = 0; i < found.length; i++) {
      if (visit(found[i])) return found[i];
    }
  }
  return null;
}

// First loaded code element matching language + cached source text.
export function ng34FindCodeBlock(sections, language, text) {
  return ng34EachSection(sections, 'code[class*="language-"].is-loaded', (el) =>
    ng34CodeBlockText(el) === text && ng34CodeLanguage(el) === language);
}

// First loaded math element matching text and block/inline kind.
export function ng34FindMath(sections, text, isBlock) {
  return ng34EachSection(sections, ".math.is-loaded", (el) =>
    ng34MathTextMap.get(el) === text && el.classList.contains("math-block") === isBlock);
}

// Attribute-wise equality over the given names (missing == missing).
export function ng34SameAttributes(a, b, names) {
  for (const name of names) {
    if (a.getAttr(name) !== b.getAttr(name)) return false;
  }
  return true;
}

// First loaded internal embed matching src/width/height/alt.
export function ng34FindInternalEmbed(sections, el) {
  return ng34EachSection(sections, ".internal-embed.is-loaded", (candidate) =>
    ng34SameAttributes(candidate, el, ["src", "width", "height", "alt"]));
}

function ng34IsImage(el) {
  return typeof HTMLImageElement !== "undefined" && el instanceof HTMLImageElement;
}

// First complete image with the same src; copies width/height/alt onto it.
export function ng34FindImage(sections, img, source) {
  return ng34EachSection(sections, "img", (candidate) => {
    if (!ng34IsImage(candidate) || !candidate.complete || candidate.src !== source) return false;
    for (const name of ["width", "height", "alt"]) {
      const value = img.getAttribute(name);
      if (value !== null) candidate.setAttribute(name, value);
    }
    return true;
  });
}

// Renders a callout icon: quoted strings are unwrapped, "<svg" payloads are
// sanitised and inlined, anything else goes through the icon renderer.
export function ng34RenderCalloutIcon(el, icon) {
  let name = icon;
  if (typeof icon === "string" && icon.length > 1) {
    if (icon.charAt(0) === "'" && icon.charAt(icon.length - 1) === "'") {
      name = icon.slice(1, -1).replace(/\\'/g, "'");
    } else if (icon.charAt(0) === '"') {
      try {
        const parsed = JSON.parse(icon);
        if (typeof parsed === "string") name = parsed;
      } catch (e) {
        // keep the raw text
      }
    }
  }
  if (typeof name === "string" && name.indexOf("<svg") === 0) {
    const holder = env().xL(name);
    const node = holder && holder.firstChild;
    if (typeof SVGSVGElement !== "undefined" && node instanceof SVGSVGElement) {
      node.setAttribute("width", "16");
      node.setAttribute("height", "16");
      node.setAttribute("fill", "currentColor");
      node.setAttribute("stroke", "currentColor");
      el.empty();
      el.appendChild(node);
      return;
    }
  }
  env().tv(el, name);
}

// Internal-link href of a rendered element belonging to the section.
export function ng34InternalLinkHref(el, section) {
  const href = el.getAttr("data-href") || el.getAttr("href");
  return href && env().Gz.belongsToMe(el, section) ? href : null;
}

// First heading child element.
export function ng34FirstHeading(el, cb) {
  const first = el.firstChild;
  if (first instanceof HTMLHeadingElement) cb(first);
}

// List items that contain a nested ul/ol.
export function ng34NestedListItems(el, cb) {
  const items = el.findAll("li");
  for (let i = 0; i < items.length; i++) {
    if (items[i].findAll("ul,ol").length > 0) cb(items[i]);
  }
}

// Order-sensitive range equality via the app's Array.prototype.eq.
export function ng34RangesEqual(a, b) {
  if (a.length === b.length) return a.eq(b);
  if (a.length < b.length) return b.slice(0, a.length).eq(a);
  return a.slice(0, b.length).eq(b);
}

// Splits markdown into per-top-level-node sections with relative data-line
// numbering; leaves the parse tree mutated (single-child children array).
export function ng34ParseMarkdownSections(text) {
  const tree = env().Kx(text);
  const defs = { definitions: env().oT(tree) };
  const frontmatter = env().$x(tree);
  const children = tree.children || [];
  tree.children = [null];
  const sections = [];
  for (const node of children) {
    const level = node.type === "heading" ? node.depth || 1 : 7;
    env().jC(node, ["checklist", "listItem", "code"], (child) => {
      if (!child.data) child.data = {};
      if (!child.data.hProperties) child.data.hProperties = {};
      child.data.hProperties["data-line"] = String(child.position.start.line - node.position.start.line);
    });
    tree.children[0] = node;
    sections.push({ html: env().Zx(tree, defs), pos: env().hT(node.position), level });
  }
  return { sections, frontmatter };
}

// First rendered mermaid block matching the cached source text.
export function ng34FindMermaid(sections, text) {
  return ng34EachSection(sections, ".mermaid", (el) => ng34CodeBlockText(el) === text);
}
