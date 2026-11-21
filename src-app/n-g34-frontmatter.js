// g34 clean-room: frontmatter merge/split/serialise helpers and the
// link-update record for a rename (spec g34 part B).
import { frontmatterBounds } from "./notes-utils.js";
import { parseLinktext } from "./path.js";
import { ng34WikiLinkPattern, ng34RewriteLinkText } from "./n-g34-links.js";

const NG34_FM_OWN = Object.prototype.hasOwnProperty;

function ng34AsObject(value) {
  return value !== null && typeof value === "object" ? value : {};
}

// Merges `mutate(data)` into the note's frontmatter and returns the new text.
export function ng34MergeFrontmatter(text, mutate, host) {
  const bounds = frontmatterBounds(text);
  let data = {};
  if (bounds.exists) data = ng34AsObject(host.parseYaml(bounds.frontmatter));
  mutate(data);
  if (Object.keys(data).length === 0) {
    return bounds.exists ? text.slice(bounds.contentStart) : text;
  }
  const yaml = host.yamlStringify(data);
  if (bounds.exists) return text.slice(0, bounds.from) + yaml + text.slice(bounds.to);
  return "---\n" + yaml + "---\n" + text;
}

// Body content plus the parsed frontmatter object.
export function ng34SplitFrontmatter(text, host) {
  const bounds = frontmatterBounds(text);
  return {
    content: text.slice(bounds.contentStart),
    frontmatter: bounds.exists ? host.parseYaml(bounds.frontmatter) : {},
  };
}

// Serialises an object to a "---" fenced block; "" for empty input.
export function ng34FrontmatterText(frontmatter, host) {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return "";
  return "---\n" + host.yamlStringify(frontmatter).trim() + "\n---\n";
}

// Replaces (or prepends) the note's frontmatter block, keeping the body.
export function ng34SetFrontmatter(text, frontmatter, host) {
  return ng34FrontmatterText(frontmatter, host) + text.slice(frontmatterBounds(text).contentStart);
}

function ng34UniqueConcat(a, b) {
  const merged = a.concat(b);
  if (typeof merged.unique === "function") return merged.unique();
  return merged.filter((v, i) => merged.indexOf(v) === i);
}

// Deep-merges plain objects: arrays concat+dedupe, objects recurse,
// null never overwrites, missing keys are assigned verbatim.
export function ng34DeepMerge(target, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  for (const key of keys) {
    const value = patch[key];
    if (!NG34_FM_OWN.call(target, key)) {
      target[key] = value;
      continue;
    }
    const current = target[key];
    if (Array.isArray(current) && Array.isArray(value)) {
      target[key] = ng34UniqueConcat(current, value);
    } else if (current !== null && typeof current === "object" && value !== null && typeof value === "object") {
      ng34DeepMerge(current, value);
    } else if (value !== null) {
      target[key] = value;
    }
  }
}

function ng34SamePaths(a, b) {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

// Computes the metadataCache link update produced when `change`'s file was
// renamed; undefined when resolution is unchanged or the text is identical.
export function ng34LinkUpdateForRename(change, metadataCache, host) {
  const reference = change.reference;
  const parsed = parseLinktext(reference.link);
  const dest = metadataCache.getLinkpathDest(parsed.path, change.sourceFile.path) || [];
  const now = dest.map((f) => f.path);
  if (now.length === 0) return undefined;
  const before = change.resolvedPaths || [];
  if (ng34SamePaths(before, now)) return undefined;
  const wiki = ng34WikiLinkPattern.test(reference.original);
  const newLink = metadataCache.fileToLinktext(change.resolvedFile, change.sourceFile.path, wiki) + parsed.subpath;
  if (newLink === reference.link) return undefined;
  return {
    sourcePath: change.sourceFile.path,
    reference,
    change: ng34RewriteLinkText(reference, newLink, host),
  };
}
