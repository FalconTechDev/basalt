// g39 clean-room: quick-switcher fuzzy matching (spec g39 part B).
// Tokenizer + scorer + matcher; mirrors the app-core Rust twin's semantics.

const NG39_ASCII_SEP = new Set("'\"!#$%&()*+,-./:;<=>?@[\\]^_`{|}~".split(""));

function ng39IsSepUnit(u) {
  if (u >= 0x2000 && u <= 0x206f) return true;
  if (u >= 0x2e00 && u <= 0x2e7f) return true;
  if (u < 128 && NG39_ASCII_SEP.has(String.fromCharCode(u))) return true;
  return false;
}

function ng39IsCjkUnit(u) {
  return (u >= 0x0f00 && u <= 0x0fff) || (u >= 0x3040 && u <= 0x30ff)
    || (u >= 0x3400 && u <= 0x4dbf) || (u >= 0x4e00 && u <= 0x9fff)
    || (u >= 0xf900 && u <= 0xfaff) || (u >= 0xff66 && u <= 0xff9f);
}

function ng39IsSpaceChar(ch) { return /\s/.test(ch); }

export function ng39PrepareQuery(query) {
  const q = String(query);
  const lower = q.toLowerCase();
  const tokens = [];
  const fuzzy = [];
  let run = "";
  const flush = () => { if (run) { tokens.push(run); run = ""; } };
  for (let i = 0; i < lower.length; i++) {
    const ch = lower.charAt(i);
    const u = lower.charCodeAt(i);
    if (ng39IsSpaceChar(ch)) { flush(); continue; }
    if (!ng39IsSpaceChar(ch)) fuzzy.push(ch);
    if (ng39IsSepUnit(u) || ng39IsCjkUnit(u)) { flush(); tokens.push(ch); continue; }
    run += ch;
  }
  flush();
  return { query: q, tokens, fuzzy };
}

export function ng39MatchScore(spans, queryLength, textLength, camelBreaks) {
  if (!spans || !spans.length) return 0;
  const first = spans[0][0];
  const last = spans[spans.length - 1][1];
  return -(spans.length - 1) - (camelBreaks || 0) / 10
    - (last - first + 1 - queryLength) / 100 - first / 1000 - textLength / 10000;
}

function ng39Unit(charCode) {
  return charCode >= 0 && charCode <= 0xffff ? charCode : -1;
}

function ng39LowerDiffers(u) {
  if (u < 0) return false;
  const c = String.fromCharCode(u);
  return c.toLowerCase() !== c;
}

function ng39UpperDiffers(u) {
  if (u < 0) return false;
  const c = String.fromCharCode(u);
  return c.toUpperCase() !== c;
}

function ng39MatchTokens(tokens, qlen, text, lower, fuzzyMode) {
  if (!tokens.length) return null;
  let camel = 0;
  let from = 0;
  const spans = [];
  let l = 0;
  while (l < tokens.length) {
    const tok = tokens[l];
    const u = lower.indexOf(tok, from);
    if (u < 0) return null;
    const h = ng39Unit(text.charCodeAt(u));
    const hBoundary = h >= 0 && (ng39IsSepUnit(h) || ng39IsCjkUnit(h));
    if (u > 0 && !hBoundary) {
      const p = ng39Unit(text.charCodeAt(u - 1));
      const hl = ng39LowerDiffers(h);
      const hu = ng39UpperDiffers(h);
      const pl = ng39LowerDiffers(p);
      const pPlain = !(p >= 0 && (ng39IsSepUnit(p) || ng39IsCjkUnit(p) || ng39IsSpaceChar(String.fromCharCode(p))));
      if ((hl && pl) || (hu && pPlain)) {
        if (fuzzyMode) {
          if (u !== from) { from += tok.length; continue; }
        } else {
          camel++;
        }
      }
    }
    const last = spans[spans.length - 1];
    if (last && last[1] >= u) last[1] = u + tok.length;
    else spans.push([u, u + tok.length]);
    from = u + tok.length;
    l++;
  }
  return { spans, score: ng39MatchScore(spans, qlen, lower.length, camel) };
}

export function ng39FuzzyMatchJs(prepared, text) {
  if (!prepared.query) return { score: 0, matches: [] };
  const t = String(text);
  const lower = t.toLowerCase();
  const qlen = prepared.query.length;
  const r = ng39MatchTokens(prepared.tokens, qlen, t, lower, false)
    || ng39MatchTokens(prepared.fuzzy, qlen, t, lower, true);
  return r ? { score: r.score, matches: r.spans } : null;
}
