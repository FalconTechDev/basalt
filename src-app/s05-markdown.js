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
