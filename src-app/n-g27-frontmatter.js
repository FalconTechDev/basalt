// g27 frontmatter: readers for well-known properties of a PARSED frontmatter
// object (plain JS object from the YAML parser — never raw text).
// frontmatterEntry(frontmatter, key): string key = own property lookup
// (hasOwnProperty — inherited names never match); RegExp key = first own
// enumerable key (in enumeration order) that test()s true.
// frontmatterStrings: scalar string -> [trimmed]; array -> trimmed string
// elements only (other types dropped, [] possible); anything else -> null.
// frontmatterTags: /^tags$/i via frontmatterStrings, drop empties and entries
// containing a space, prefix "#" unless already present.
// frontmatterAliases: /^aliases$/i via frontmatterStrings, trim again, drop
// empties.

function ng27FmLookup(frontmatter, key) {
  if (frontmatter == null) return null;
  if (typeof key === "string") {
    return Object.prototype.hasOwnProperty.call(frontmatter, key) ? frontmatter[key] : null;
  }
  for (const name of Object.keys(frontmatter)) {
    if (key.test(name)) return frontmatter[name];
  }
  return null;
}

export function frontmatterEntry(frontmatter, key) {
  return ng27FmLookup(frontmatter, key);
}

export function frontmatterStrings(frontmatter, key) {
  const value = ng27FmLookup(frontmatter, key);
  if (!value) return null;
  if (typeof value === "string") return [value.trim()];
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      if (typeof item === "string") out.push(item.trim());
    }
    return out;
  }
  return null;
}

export function frontmatterTags(frontmatter) {
  const list = frontmatterStrings(frontmatter, /^tags$/i);
  if (list == null) return null;
  const out = [];
  for (const tag of list) {
    if (!tag || tag.indexOf(" ") >= 0) continue;
    out.push(tag.charAt(0) === "#" ? tag : "#" + tag);
  }
  return out;
}

export function frontmatterAliases(frontmatter) {
  const list = frontmatterStrings(frontmatter, /^aliases$/i);
  if (list == null) return null;
  const out = [];
  for (const alias of list) {
    const trimmed = alias.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
