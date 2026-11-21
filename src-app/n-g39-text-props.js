// g39 clean-room: pure helpers, file 5 of 3 (spec g39 part A) — property ids,
// heading normalisation, cli option summary.

const NG39_PROP_PREFIXES = ["note", "formula", "file"];

export function ng39ParsePropertyId(id) {
  const s = String(id);
  const dot = s.indexOf(".");
  if (dot > 0) {
    const prefix = s.slice(0, dot);
    if (NG39_PROP_PREFIXES.indexOf(prefix) >= 0) {
      return { type: prefix, name: s.slice(dot + 1) };
    }
  }
  return { type: "note", name: s };
}

export function ng39PropertyId(type, name) {
  return type + "." + name;
}

export function ng39ShortPropertyId(id) {
  const s = String(id);
  if (s.length > 5 && s.slice(0, 5) === "note.") {
    const rest = s.slice(5);
    const dot = rest.indexOf(".");
    const head = dot < 0 ? rest : rest.slice(0, dot);
    if (NG39_PROP_PREFIXES.indexOf(head) < 0) return rest;
    return s;
  }
  if (s === "file.file") return "file";
  return s;
}

export function ng39LongPropertyId(id) {
  const s = String(id);
  for (const p of NG39_PROP_PREFIXES) {
    if (s.slice(0, p.length + 1) === p + ".") return s;
  }
  if (s === "file") return "file.file";
  return "note." + s;
}

export function ng39UniqueName(taken, name) {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = name + " " + n;
    if (!taken.has(candidate)) return candidate;
  }
}

const NG39_HEADING_BAD = /[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\\r\n]/g;

export function ng39PlainHeading(heading) {
  return String(heading).replace(NG39_HEADING_BAD, " ").replace(/\s+/g, " ").trim();
}

const NG39_LINK_BAD_TOKENS = /%%|\[\[|\]\]/g;
const NG39_LINK_BAD_CHARS = /[:#|^\\\r\n]/g;

export function ng39LinkSafeHeading(heading) {
  return String(heading)
    .replace(NG39_LINK_BAD_TOKENS, "")
    .replace(NG39_LINK_BAD_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ng39DescribeCliOptions(options) {
  if (!options) return "";
  const keys = Object.keys(options);
  if (!keys.length) return "";
  const parts = [];
  for (const key of keys) {
    const opt = options[key];
    const body = opt && opt.value ? key + "=" + opt.value : key;
    parts.push(opt && opt.required ? body : "[" + body + "]");
  }
  return parts.join(" ");
}
