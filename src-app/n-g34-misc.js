// g34 clean-room: DOMPurify options, comment prefix, date formats/patterns,
// path comparator, class filter and sanitise-to-fragment (spec g34 part D).

export const ng34SanitizeOptions = {
  ALLOW_UNKNOWN_PROTOCOLS: true,
  RETURN_DOM_FRAGMENT: true,
  FORBID_TAGS: ["style"],
  ADD_TAGS: ["iframe"],
  ADD_ATTR: ["frameborder", "allowfullscreen", "allow", "sandbox", "data-tooltip-position"],
};

export const ng34HtmlCommentPrefix = "<!-- basalt -->";

export const ng34DayFormats = ["YYYY-MM-DD"];

export const ng34DateTimeFormats = [
  "YYYY-MM-DD[T]HH:mm:ss",
  "YYYY-MM-DD[T]HH:mm",
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DD HH:mm",
];

export const ng34DayPattern = /^\d{4}-[01]\d-[0-3]\d$/;
export const ng34DateTimePattern = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/;

// Shorter paths sort first; equal lengths keep the caller's stable order.
export function ng34PathLengthCompare(a, b) {
  return a.path.length - b.path.length;
}

const NG34_MISC_OWN = Object.prototype.hasOwnProperty;

// Keeps only allowed class tokens (trimmed, lowercased, own-property match);
// rewrites the attribute only when the joined result differs.
export function ng34FilterClasses(el, attr, separator, allowed) {
  const value = el.getAttribute(attr);
  if (value == null) return;
  const kept = [];
  for (const token of value.split(separator)) {
    const norm = token.trim().toLowerCase();
    if (NG34_MISC_OWN.call(allowed, norm) && allowed[norm]) kept.push(norm);
  }
  const joined = kept.join(separator);
  if (joined !== value) el.setAttribute(attr, joined);
}

// Sanitises html into a DocumentFragment with the shared options.
export function ng34SanitizeHtml(html, host) {
  return document.importNode(host.s20Dompurify.sanitize(html, ng34SanitizeOptions), true);
}
