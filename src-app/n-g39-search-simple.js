// g39 clean-room: simple all-words matching, match-span rendering, wiki-link
// sub-path resolution (spec g39 part C).
import { ng39PrepareQuery, ng39MatchScore, ng39FuzzyMatchJs } from "./n-g39-search.js";
import { ng39PlainHeading } from "./n-g39-text-props.js";

export function ng39MergeSpans(spans) {
  if (!spans || !spans.length) return [];
  spans.sort((a, b) => a[0] - b[0]);
  const out = [spans[0].slice()];
  for (let i = 1; i < spans.length; i++) {
    const s = spans[i];
    const last = out[out.length - 1];
    if (last[1] < s[0]) out.push(s.slice());
    else if (s[1] > last[1]) last[1] = s[1];
  }
  return out;
}

export function ng39ContainsAllWords(words, text) {
  const lower = String(text).toLowerCase();
  const spans = [];
  for (const w of words) {
    if (!w) continue;
    let found = false;
    let at = 0;
    for (;;) {
      const i = lower.indexOf(w, at);
      if (i < 0) break;
      found = true;
      spans.push([i, i + w.length]);
      at = i + w.length + 1;
    }
    if (!found) return null;
  }
  return ng39MergeSpans(spans);
}

export function ng39SimpleMatch(words, query, text) {
  const spans = ng39ContainsAllWords(words, text);
  if (!spans) return null;
  return { score: ng39MatchScore(spans, String(query).length, String(text).length, 0), matches: spans };
}

export function ng39PrepareFuzzyFinder(query) {
  const prepared = ng39PrepareQuery(query);
  return (text) => ng39FuzzyMatchJs(prepared, text);
}

export function ng39PrepareSimpleFinder(query) {
  const words = String(query).toLowerCase().split(" ");
  return (text) => ng39SimpleMatch(words, query, text);
}
