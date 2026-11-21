// g39 clean-room: match-span DOM rendering + wiki-link sub-path resolution
// (spec g39 part C), second file.
import { ng39PlainHeading } from "./n-g39-text-props.js";

export function ng39RenderMatches(el, text, ranges, offset) {
  const off = offset || 0;
  const s = String(text);
  const frag = document.createDocumentFragment();
  let cursor = 0;
  const emit = (a, b) => {
    if (a > cursor) frag.appendChild(document.createTextNode(s.slice(cursor, a)));
    if (b > a) {
      const span = document.createElement("span");
      span.className = "suggestion-highlight";
      span.textContent = s.slice(a, b);
      frag.appendChild(span);
    }
    cursor = Math.max(cursor, b);
  };
  if (ranges) {
    for (const r of ranges) {
      let a = r[0] + off;
      let b = r[1] + off;
      if (b <= 0) continue;
      if (a >= s.length) break;
      if (a < 0) a = 0;
      if (b > s.length) b = s.length;
      emit(a, b);
    }
  }
  if (cursor < s.length) frag.appendChild(document.createTextNode(s.slice(cursor)));
  el.appendChild(frag);
}

export function ng39RenderResults(el, text, result, offset) {
  ng39RenderMatches(el, text, result ? result.matches : null, offset);
}

function ng39HeadingKey(h) {
  return ng39PlainHeading(String(h && h.heading !== undefined ? h.heading : h)).toLowerCase();
}

export function ng39ResolveSubpath(cache, subpath) {
  if (!cache || !subpath) return null;
  const parts = String(subpath).split("#").filter((p) => p.length > 0);
  if (!parts.length) return null;
  const blocks = cache.blocks || {};
  const listItems = cache.listItems || [];
  const footnotes = cache.footnotes || [];
  const headings = cache.headings || [];

  if (parts.length === 1) {
    const p = parts[0];
    if (p.charAt(0) === "^") {
      const id = p.slice(1).toLowerCase();
      let block = null;
      if (Object.prototype.hasOwnProperty.call(blocks, id)) block = blocks[id];
      else {
        for (const k of Object.keys(blocks)) {
          if (k.toLowerCase() === id) { block = blocks[k]; break; }
        }
      }
      if (!block) return null;
      let list = null;
      for (const item of listItems) {
        if (item && String(item.id).toLowerCase() === id) { list = item; break; }
      }
      return { type: "block", block, list, start: block.position.start, end: block.position.end };
    }
    if (p.length > 2 && p.slice(0, 2) === "[^" && p.charAt(p.length - 1) === "]") {
      const id = p.slice(2, -1);
      for (const f of footnotes) {
        if (f && f.id === id) {
          return { type: "footnote", footnote: f, start: f.position.start, end: f.position.end };
        }
      }
      return null;
    }
  }

  let prevLevel = 0;
  let found = null;
  let foundIndex = -1;
  let hi = 0;
  for (const part of parts) {
    const want = ng39PlainHeading(part).toLowerCase();
    let hit = -1;
    for (let i = hi; i < headings.length; i++) {
      const h = headings[i];
      if (h && h.level > prevLevel && ng39HeadingKey(h) === want) { hit = i; break; }
    }
    if (hit < 0) return null;
    found = headings[hit];
    foundIndex = hit;
    prevLevel = found.level;
    hi = hit + 1;
  }
  let next = null;
  for (let i = foundIndex + 1; i < headings.length; i++) {
    if (headings[i] && headings[i].level <= prevLevel) { next = headings[i]; break; }
  }
  return {
    type: "heading", current: found, next,
    start: found.position.start,
    end: next ? next.position.start : null,
  };
}
