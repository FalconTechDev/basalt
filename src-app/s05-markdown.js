// s05 slice: markdown -> metadata-cache record builder (links, embeds, tags,
// headings, footnotes, sections, list items, block ids, frontmatter).
import { env } from "./env.js";
import { s05Range, s05Point, s05FrontmatterLinks, s05InlineText } from "./s05-utils.js";

const WALKED_TYPES = ["heading", "ilink", "iembed", "tag", "listItem", "fnRef", "footnoteDefinition", "definition"];

// Parse `markdownText` into the file-cache record. When `stripOriginal` is set
// the raw `[[...]]`/`[...](...)` source text is omitted from link/embed entries.
export function s05ParseCache(markdownText, stripOriginal) {
  const cache = {
    links: [], embeds: [], tags: [], headings: [], footnotes: [],
    footnoteRefs: [], referenceLinks: [], sections: [], listItems: [], blocks: {},
  };
  const tree = env().Kx(markdownText);
  const first = tree.children[0];
  if (first && first.type === "yaml") {
    const frontmatter = env().$x(tree);
    if (frontmatter) {
      cache.frontmatter = frontmatter;
      cache.frontmatterPosition = s05Range(first.position);
      cache.frontmatterLinks = s05FrontmatterLinks(frontmatter);
    }
  }
  for (const node of tree.children) {
    const position = s05Range(node.position);
    const section = { type: node.type, position };
    const id = node.id;
    if (id && typeof id === "string") {
      section.id = id;
      cache.blocks[id.toLowerCase()] = { position, id };
    }
    cache.sections.push(section);
  }
  env().jC(tree, WALKED_TYPES, (node, _index, parent) => {
    if (node.type === "fnRef") {
      const contentPosition = node.data?.contentPosition;
      if (contentPosition) {
        cache.footnotes.push({ position: s05Range(contentPosition), id: node.identifier || "" });
      } else {
        cache.footnoteRefs.push({ position: s05Range(node.position), id: node.identifier || "" });
      }
    } else if (node.type === "footnoteDefinition") {
      cache.footnotes.push({ position: s05Range(node.position), id: node.identifier || "" });
    } else if (node.type === "definition" && node.url) {
      const id = node.label || node.identifier;
      cache.referenceLinks.push({ position: s05Range(node.position), id: id || "", link: node.url || "" });
    } else if (node.type === "heading" && parent.type === "root") {
      const heading = env().UC(markdownText, node);
      cache.headings.push({ position: s05Range(node.position), heading, level: node.depth || 1 });
    } else if (node.type === "ilink") {
      const original = markdownText.substring(node.position.start.offset, node.position.end.offset);
      const link = node.href || "";
      let displayText = node.title || "";
      if (!displayText && node.converted) displayText = s05InlineText(node);
      const entry = { position: s05Range(node.position), link, original, displayText };
      if (stripOriginal) delete entry.original;
      cache.links.push(entry);
    } else if (node.type === "iembed") {
      const original = markdownText.substring(node.position.start.offset, node.position.end.offset);
      const link = node.href || "";
      const displayText = node.title || "";
      const entry = { position: s05Range(node.position), link, original, displayText };
      if (stripOriginal) delete entry.original;
      cache.embeds.push(entry);
    } else if (node.type === "tag") {
      cache.tags.push({ position: s05Range(node.position), tag: node.tag || "" });
    } else if (node.type === "listItem") {
      if (node.synthetic) {
        if (node.data?.isInline) return;
        return "skip";
      }
      const position = s05Range(node.position);
      const children = node.children;
      if (children && children.length > 1) {
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (child.type !== "list") {
            position.end = s05Point(child.position.end);
            break;
          }
          child.listParentPosition = node.position;
        }
      }
      let parentLine = 0;
      if (parent.type === "list") {
        if (parent.listParentPosition) {
          parentLine = parent.listParentPosition.start.line - 1;
        } else {
          parentLine = -(parent.position.start.line - 1);
          if (parentLine === 0) parentLine = -1;
        }
      }
      const item = { position, parent: parentLine };
      const checklist = node.checklist;
      if (typeof checklist === "string") item.task = checklist;
      const id = node.id;
      if (id && typeof id === "string") {
        item.id = id;
        cache.blocks[id.toLowerCase()] = { position, id };
      }
      cache.listItems.push(item);
    }
  });
  if (cache.links.length === 0) delete cache.links;
  if (cache.embeds.length === 0) delete cache.embeds;
  if (cache.tags.length === 0) delete cache.tags;
  if (cache.headings.length === 0) delete cache.headings;
  if (cache.footnotes.length === 0) delete cache.footnotes;
  if (cache.footnoteRefs.length === 0) delete cache.footnoteRefs;
  if (cache.referenceLinks.length === 0) delete cache.referenceLinks;
  if ((cache.sections.length === 0 || stripOriginal)) delete cache.sections;
  if (cache.listItems.length === 0) delete cache.listItems;
  if (Object.keys(cache.blocks).length === 0) delete cache.blocks;
  return cache;
}

// Extract the editable region for a `file#subpath` target: for a block quote
// or list it returns the un-indented inner text; for a heading it keeps the
// heading line in `heading`; for a footnote it strips the marker and re-joins
// continuation lines. Returns {before, after, indent, heading, content}.
export function s05ExtractSubpath(text, cache, section, editable = false) {
  let before = "";
  let after = "";
  let indent = "";
  let heading = "";
  let content = "";
  if (section.type === "block" && section.list) {
    const deepest = (cache, item) => {
      const items = cache.listItems;
      if (!items) return item;
      const index = items.indexOf(item);
      if (index === -1) return item;
      const seen = new Set();
      seen.add(item.position.start.line);
      let deepestItem = item;
      for (let i = index + 1; i < items.length; i++) {
        const next = items[i];
        if (!seen.has(next.parent)) break;
        seen.add(next.position.start.line);
        deepestItem = next;
      }
      return deepestItem;
    };
    const last = deepest(cache, section.list);
    const span = {
      start: section.list.position.start.offset - section.list.position.start.col,
      end: last.position.end.offset,
    };
    const start = span.start;
    const end = span.end;
    before = text.substring(0, start);
    after = text.substring(end);
    const dedent = (block) => {
      const lines = block.split("\n");
      const firstIndent = lines[0].match(/^\s*/)[0];
      const width = firstIndent.replace(/\t/g, "    ").length;
      if (width > 0) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let col = 0;
          let cut = 0;
          while (cut < line.length && col < width) {
            col += line.charAt(cut) === "\t" ? 4 : 1;
            cut++;
          }
          lines[i] = line.substr(cut);
        }
      }
      return { indent: firstIndent, text: lines.join("\n") };
    };
    const block = dedent(text.substring(start, end));
    content = block.text;
    indent = block.indent;
  } else {
    const start = section.start.offset;
    const end = section.end ? section.end.offset : text.length;
    let contentStart = start;
    if (editable && section.type === "heading") {
      contentStart = section.current.position.end.offset + 1;
      heading = text.substring(start, contentStart);
    }
    before = text.substring(0, start);
    after = text.substring(end);
    content = text.substring(contentStart, end);
  }
  if (section.type === "footnote") {
    const marker = content.match(/^\[\^[^\]]+\]:\s*/);
    if (marker) {
      before += marker[0];
      content = content.slice(marker[0].length);
    }
    content = content.replace(/\n( {4}|\t)/g, "\n");
  }
  return { before, after, indent, heading, content };
}
