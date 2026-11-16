// The search query engine: parses the query text (`foo tag:#bar path:x/y -draft line:(a|b)`) into a tree of
// matchers and matches it against a SearchTarget (the searchable strings of one file plus its metadata cache).
//
// Layers, bottom to top:
//   tokenizeQuery        -> flat token list (text, quote, regex, brackets, operators, AND/OR/TRUE/FALSE/EMPTY words)
//   parseAndSequence     -> one implicit-AND group of matchers
//   parseOrExpression    -> OR groups on top of that
//   buildMatcher         -> entry point used by SearchQuery
// Every matcher answers match(target) -> result object | null (definitely no match) | undefined (no opinion) and
// can describe itself (getInfo) and where it sits in the query text (getContext, for "explain search").
//
// The classes are plain constructor functions linked with `inherit` (the same ES5-style pattern the rest of the
// bundle uses); `cls` is the module registry so each class can derive from / test against its siblings regardless
// of the order the bundle initialises them in (the bundle order already guarantees base classes come first).

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { shiftRanges } from "./misc.js";
import { mergeSpans } from "./search-simple.js";
import { frontmatterTags } from "./frontmatter.js";
import { keyIgnoringCase } from "./text.js";
import { lastSegment } from "./path.js";

const cls = {};
// Live registry of every matcher/query class defined below; other own modules test against it (instanceof).
export const searchClasses = cls;

// =====================================================================================================================
// Small helpers
// =====================================================================================================================

/** Escapes every regex metacharacter so the text matches literally. */
export function escapeRegExpQuery(text) {
  return text.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
}

const RESULT_KEYS = ["filename", "filepath", "content", "propertyName", "tag"];

/** Merges the match ranges of `from` into `into`, per key (from-ranges first), plus frontmatter property hits. */
export function mergeMatchResults(into, from) {
  for (const key of RESULT_KEYS) {
    if (from[key]) into[key] = from[key].concat(into[key] !== undefined && into[key] !== null ? into[key] : []);
  }
  if (from.properties) into.properties = from.properties.concat(into.properties !== undefined && into.properties !== null ? into.properties : []);
}

// Regex caches, one per case sensitivity; cleared a minute after the last query (same policy as the original).
let regexCacheSensitive = {};
let regexCacheInsensitive = {};
/** Schedules the regex caches to be dropped (called on every match; debounced, so quiet periods clear them). */
export const resetRegexCaches = debounceCall(() => { regexCacheSensitive = {}; regexCacheInsensitive = {}; }, 60000, true);

/** The cached global+multiline RegExp for `source` (case-insensitive unless `caseSensitive`). */
export function cachedRegExp(source, caseSensitive) {
  const cache = caseSensitive ? regexCacheSensitive : regexCacheInsensitive;
  let re = null;
  if (cache.hasOwnProperty(source)) re = cache[source];
  if (!re) re = cache[source] = new RegExp(source, caseSensitive ? "gm" : "gmi");
  return re;
}

/** All [start,end) ranges where `re` matches `text`; with `wholeWord` only the first capture group counts. */
export function regexMatchRanges(re, text, wholeWord) {
  const ranges = [];
  if (!text) return ranges;
  re.lastIndex = 0;
  for (;;) {
    const match = re.exec(text);
    if (!match) break;
    let length = match[0].length;
    if (length === 0) {
      re.lastIndex++;
      continue;
    }
    if (wholeWord) {
      if (!match[1] || match[1].length === 0) {
        re.lastIndex++;
        continue;
      }
      length = match[1].length;
    }
    const end = re.lastIndex;
    ranges.push([end - length, end]);
  }
  return ranges;
}

let wordCharRe = null;
function wordCharTest() {
  if (!wordCharRe) wordCharRe = new RegExp("[" + __basaltHost.WordCharSource + "]");
  return wordCharRe;
}

/** The regex source that matches `text` only as a whole word (word chars on both ends get boundaries). */
export function wholeWordPattern(text) {
  if (text.length === 0) return "";
  const re = wordCharTest();
  const source = __basaltHost.WordCharSource;
  const first = re.test(text.charAt(0));
  const last = re.test(text.charAt(text.length - 1));
  return (first ? "(?:^|[^" + source + "])" : "")
    + "(" + escapeRegExpQuery(text) + ")"
    + (last ? "(?![" + source + "])" : "()");
}

/** True for extensions whose content is not indexed as searchable text (those also get their file name matched). */
export function extensionWithoutContent(extension) {
  return !__basaltHost.SearchableExtensions.includes(extension);
}

// =====================================================================================================================
// Tokenizer
// =====================================================================================================================

/**
 * Splits the query into tokens. Words become text/true/false/empty/or tokens; `"..."` quotes, `/.../` regexes,
 * `[` `]` `(` `)` `:` `>` `<` punctuation, and a leading `-` becomes a not token.
 */
export function tokenizeQuery(query) {
  const tokens = [];
  const n = query.length;
  const pushWord = (word, pos) => {
    if (word === "TRUE") tokens.push({ type: "true", content: word, pos });
    else if (word === "FALSE") tokens.push({ type: "false", content: word, pos });
    else if (word === "EMPTY") tokens.push({ type: "empty", content: word, pos });
    else if (word === "OR") tokens.push({ type: "or", content: word, pos });
    else tokens.push({ type: "text", content: word, pos });
  };
  let i = 0;
  while (i < n) {
    const ch = query.charAt(i);
    if (ch === '"') {
      const start = i;
      i++;
      let text = "";
      while (i <= n) {
        if (i === n) { tokens.push({ type: "quote", content: text, pos: start }); break; }
        const c = query.charAt(i);
        i++;
        if (c === "\\" && i < n) { text += query.charAt(i); i++; }
        else if (c === '"') { tokens.push({ type: "quote", content: text, pos: start }); break; }
        else text += c;
      }
      continue;
    }
    if (ch === "/") {
      const start = i;
      i++;
      let pattern = "";
      while (i <= n) {
        if (i === n) { tokens.push({ type: "regex", content: pattern, pos: start }); break; }
        const c = query.charAt(i);
        i++;
        if (c === "\\" && i < query.length) {
          const next = query.charAt(i);
          if (next === "/") { pattern += next; i++; continue; }
          if (next === "\\") { pattern += "\\\\"; i++; continue; }
        }
        if (c === "/") { tokens.push({ type: "regex", content: pattern, pos: start }); break; }
        pattern += c;
      }
      continue;
    }
    if (ch === "-") {
      const start = i;
      i++;
      tokens.push({ type: "not", content: ch, pos: start });
      continue;
    }
    // bare word: everything up to whitespace or a structural character
    const start = i;
    let word = "";
    while (i <= n) {
      if (i === n) { if (word) pushWord(word, start); break; }
      const c = query.charAt(i);
      i++;
      if (c === "[" || c === "]" || c === "(" || c === ")" || c === ":" || c === ">" || c === "<") {
        if (word) pushWord(word, start);
        const type = (c === "[" || c === "]") ? "bracket" : (c === "(" || c === ")") ? "parenthesis" : c === ":" ? "colon" : c === ">" ? "greaterthan" : "lessthan";
        tokens.push({ type, content: c, pos: i - 1 });
        break;
      }
      if (c === " ") {
        if (word) pushWord(word, start);
        break;
      }
      word += c;
    }
  }
  return tokens;
}

// =====================================================================================================================
// Parser: tokens -> matcher tree
// =====================================================================================================================

/** End offset (in the original query) covered by a token; quotes and regexes include their delimiters. */
export function tokenEnd(token) {
  const end = token.pos + token.content.length;
  return token.type === "quote" || token.type === "regex" ? end + 2 : end;
}

/** True when the token at the current parse position has the given type (peek, does not consume). */
export function checkToken(state, type) {
  return state.pos < state.tokens.length && state.tokens[state.pos].type === type;
}

/**
 * Parses one matcher (and anything it owns: operator operand, property body, parenthesised group, negation,
 * comparison). Returns null when the current token cannot start a matcher.
 */
export function parsePrimary(state) {
  const token = state.tokens[state.pos];
  if (!token) return null;
  const type = token.type;
  const content = token.content;
  let matcher;

  // named operator: "word:" followed by its operand (the operand is one matcher, usually text)
  if (type === "text" && state.pos < state.tokens.length - 1 && state.tokens[state.pos + 1].type === "colon" && !state.operatorStack.includes("[")) {
    const nameToken = token;
    const name = content.toLowerCase();
    const operator = state.operators[name];
    if (!operator) throw new Error('Operator "' + name + '" not recognized');
    if (operator.exclusive) {
      for (const open of state.operatorStack) {
        const openOp = state.operators[open];
        if (openOp.exclusive && (!openOp.allowSelf || open !== name)) {
          throw new Error('Operator "' + name + '" cannot be nested within "' + open + '"');
        }
      }
    }
    state.operatorStack.push(name);
    state.pos++;
    const valueToken = state.tokens[state.pos];
    state.pos++;
    let inner = parsePrimary(state);
    state.operatorStack.pop();
    if (!inner) inner = new cls.TextMatcher("");
    matcher = operator.operate(inner);
    matcher.matchedTokens.push(nameToken);
    matcher.matchedTokens.push(valueToken);
    return matcher;
  }

  // frontmatter property: [key] or [key:value]
  if (type === "bracket" && content === "[") {
    if (state.operatorStack.includes("[")) throw new Error("Property cannot be nested within a property.");
    state.operatorStack.push(content);
    state.pos++;
    const property = (() => {
      let key = parseOrExpression(state);
      if (!key) key = new cls.TextMatcher("");
      let value = null;
      const matched = [];
      if (checkToken(state, "colon")) {
        const colon = state.tokens[state.pos];
        state.operatorStack.push(colon.content);
        matched.push(colon);
        state.pos++;
        value = parseOrExpression(state);
        state.operatorStack.pop();
      }
      const prop = new cls.PropertyMatcher(key, value);
      prop.matchedTokens = matched;
      return prop;
    })();
    property.matchedTokens.push(token);
    state.operatorStack.pop();
    if (checkToken(state, "bracket")) property.eatToken(state);
    return property;
  }
  if (type === "bracket" && content === "]") return null;

  if (type === "text") {
    matcher = new cls.TextMatcher(content);
    matcher.eatToken(state);
    return matcher;
  }
  if (type === "quote") {
    matcher = new cls.QuotedTextMatcher(content);
    matcher.eatToken(state);
    return matcher;
  }
  if (type === "regex") {
    try { new RegExp(content); }
    catch (error) {
      console.error(error);
      throw new Error("Failed to parse regular expression. " + error.message);
    }
    matcher = new cls.RegexMatcher(content);
    matcher.eatToken(state);
    return matcher;
  }
  if (type === "parenthesis" && content === "(") {
    state.pos++;
    matcher = (() => {
      let inner = parseOrExpression(state);
      if (state.pos < state.tokens.length) {
        const next = state.tokens[state.pos];
        if (next.type === "parenthesis" && next.content === ")") {
          if (inner) inner.matchedTokens.push(next);
          state.pos++;
        }
      }
      return inner;
    })();
    if (!matcher) matcher = new cls.TextMatcher("");
    matcher.matchedTokens.push(token);
    return matcher;
  }
  if (type === "parenthesis" && content === ")") return null;
  if (type === "or") return null;
  if (type === "false" || type === "true" || type === "empty") {
    matcher = new cls.BooleanMatcher(content);
    matcher.eatToken(state);
    return matcher;
  }
  if (type === "colon") return null;
  if (type === "not") {
    state.pos++;
    const inner = parsePrimary(state);
    return inner ? (matcher = new cls.NotMatcher(inner), matcher.matchedTokens.push(token), matcher) : null;
  }
  if (type === "greaterthan" || type === "lessthan") {
    state.pos++;
    const inner = parsePrimary(state);
    return inner ? (matcher = new cls.CompareMatcher(type, inner), matcher.matchedTokens.push(token), matcher) : null;
  }
  throw new Error("Failed to parse, error at " + token.pos + ' "' + content + '"');
}

/** One implicit-AND run of matchers (stops at OR, unmatched bracket/paren or end of tokens). */
export function parseAndSequence(state) {
  const matchers = [];
  while (state.pos < state.tokens.length) {
    const matcher = parsePrimary(state);
    if (!matcher) break;
    matchers.push(matcher);
  }
  if (matchers.length === 0) return null;
  return matchers.length === 1 ? matchers[0] : new cls.AndGroup(matchers);
}

/** OR-separated groups of AND-sequences; a lone group is returned unwrapped. */
export function parseOrExpression(state) {
  const matchers = [];
  const orTokens = [];
  while (state.pos < state.tokens.length) {
    const matcher = parseAndSequence(state);
    if (matcher) {
      matchers.push(matcher);
      if (state.pos < state.tokens.length) {
        const token = state.tokens[state.pos];
        if (token.type === "or") {
          orTokens.push(token);
          state.pos++;
          continue;
        }
      }
    }
    break;
  }
  if (matchers.length === 0) return null;
  if (matchers.length === 1) return matchers[0];
  const group = new cls.OrGroup(matchers);
  group.matchedTokens = orTokens;
  return group;
}

/** Token list + operator table -> matcher tree (null for an empty query). */
export function buildMatcher(tokens, operators) {
  return parseOrExpression({ tokens, pos: 0, operatorStack: [], operators });
}

// =====================================================================================================================
// Match target
// =====================================================================================================================

// Per-match scratch keys (module-private sentinels; clones share them through the data map).
const SECTION_STATE = {};
const COMPARE_VALUE = {};

/** What a matcher runs against: the searchable strings of one file, its cache and per-match scratch data. */
export function defineSearchTarget() {
  function SearchTarget(strings, original, keys, caseSensitive) {
    this.cache = null;
    this.data = null;
    this.strings = strings;
    this.original = original;
    this.keys = keys;
    this.caseSensitive = caseSensitive;
  }
  SearchTarget.prototype.clone = function () {
    const copy = new SearchTarget(Object.assign({}, this.strings), this.original, this.keys.slice(), this.caseSensitive);
    copy.cache = this.cache;
    if (this.data) copy.data = new Map(this.data);
    return copy;
  };
  SearchTarget.prototype.cloneForPropertyContent = function (content) {
    const copy = this.clone();
    copy.keys = ["content"];
    copy.strings.content = String(content);
    copy.setData(COMPARE_VALUE, content);
    return copy;
  };
  SearchTarget.prototype.setData = function (key, value) {
    if (!this.data) this.data = new Map();
    this.data.set(key, value);
  };
  SearchTarget.prototype.getData = function (key) {
    return this.data ? this.data.get(key) : null;
  };
  SearchTarget.prototype.deleteData = function (key) {
    if (this.data) {
      this.data.delete(key);
      if (this.data.size === 0) this.data = null;
    }
  };
  cls.SearchTarget = SearchTarget;
  return SearchTarget;
}

// =====================================================================================================================
// Matcher base classes
// =====================================================================================================================

/** Every matcher: the query tokens it was built from, plus optional context lookup for "explain search". */
export function defineSearchMatcherBase() {
  function SearchMatcherBase() {
    this.matchedTokens = [];
  }
  SearchMatcherBase.prototype.eatToken = function (state) {
    this.matchedTokens.push(state.tokens[state.pos]);
    state.pos++;
  };
  SearchMatcherBase.prototype.getContext = function (pos) {
    for (const token of this.matchedTokens) {
      if (pos >= token.pos && pos <= tokenEnd(token)) return { matcherStack: [this], token };
    }
    return null;
  };
  cls.SearchMatcherBase = SearchMatcherBase;
  return SearchMatcherBase;
}

/** Wraps another matcher and changes how it is applied (case flag, key restriction, negation). */
export function defineWrappedMatcher() {
  function WrappedMatcher(matcher) {
    const self = cls.SearchMatcherBase.call(this) || this;
    self.matcher = matcher;
    return self;
  }
  inherit(WrappedMatcher, cls.SearchMatcherBase);
  WrappedMatcher.prototype.requiredInputs = function () { return this.matcher.requiredInputs(); };
  WrappedMatcher.prototype.getContext = function (pos) {
    const context = this.matcher.getContext(pos);
    if (context) {
      context.matcherStack.push(this);
      return context;
    }
    return cls.SearchMatcherBase.prototype.getContext.call(this, pos);
  };
  cls.WrappedMatcher = WrappedMatcher;
  return WrappedMatcher;
}

/** Base for matchers that split the content into pieces (lines, blocks, sections, tasks) before matching. */
export function defineSplitContentMatcher() {
  function SplitContentMatcher(matcher) {
    const self = cls.WrappedMatcher.call(this, matcher) || this;
    return self;
  }
  inherit(SplitContentMatcher, cls.WrappedMatcher);
  /**
   * Runs `iterate(clone, yieldPiece)`; each yielded piece is matched separately and the resulting ranges are
   * shifted by the piece offset. Returns { content: ranges } | undefined | null.
   */
  SplitContentMatcher.prototype.splitContentMatch = function (target, iterate) {
    const self = this;
    const clone = target.clone();
    clone.keys = ["content"];
    let anyMatch = false;
    let anyUndefined = false;
    const ranges = [];
    iterate(clone, (piece, offset) => {
      clone.strings.content = piece;
      const result = self.matcher.match(clone);
      if (result === undefined) anyUndefined = true;
      else if (result) {
        anyMatch = true;
        const content = result.content;
        if (content) {
          shiftRanges(content, offset);
          for (const range of content) ranges.push(range);
        } else {
          ranges.push([offset, offset]);
        }
      }
    });
    return anyMatch ? { content: ranges } : anyUndefined ? undefined : null;
  };
  cls.SplitContentMatcher = SplitContentMatcher;
  return SplitContentMatcher;
}

/** A matcher made of several sub-matchers (the AND and OR groups). */
export function defineMultiMatcher() {
  function MultiMatcher(matchers) {
    const self = cls.SearchMatcherBase.call(this) || this;
    self.matchers = matchers;
    return self;
  }
  inherit(MultiMatcher, cls.SearchMatcherBase);
  MultiMatcher.prototype.requiredInputs = function () {
    const inputs = {};
    for (const matcher of this.matchers) Object.assign(inputs, matcher.requiredInputs());
    return inputs;
  };
  MultiMatcher.prototype.getContext = function (pos) {
    for (const matcher of this.matchers) {
      const context = matcher.getContext(pos);
      if (context) {
        context.matcherStack.push(this);
        return context;
      }
    }
    const context = cls.SearchMatcherBase.prototype.getContext.call(this, pos);
    if (context) context.matcherStack.push(this);
    return context;
  };
  cls.MultiMatcher = MultiMatcher;
  return MultiMatcher;
}

// =====================================================================================================================
// Operator wrappers (match-case, path:, file:, content: ...)
// =====================================================================================================================

/** match-case: / ignore-case: — clones the target with the case flag flipped. */
export function defineCaseMatcher(host) {
  function CaseMatcher(matcher, caseSensitive) {
    const self = cls.WrappedMatcher.call(this, matcher) || this;
    self.caseSensitive = caseSensitive;
    return self;
  }
  inherit(CaseMatcher, cls.WrappedMatcher);
  CaseMatcher.prototype.match = function (target) {
    const clone = target.clone();
    clone.caseSensitive = this.caseSensitive;
    return this.matcher.match(clone);
  };
  CaseMatcher.prototype.getInfo = function () {
    return this.caseSensitive ? host.t.plugins.search.labelCaseSensitive() : host.t.plugins.search.labelCaseInsensitive();
  };
  cls.CaseMatcher = CaseMatcher;
  return CaseMatcher;
}

/** path: — restricts the inner matcher to the "filepath" string. */
export function definePathMatcher(host) {
  function PathMatcher(matcher) {
    const self = cls.WrappedMatcher.call(this, matcher) || this;
    return self;
  }
  inherit(PathMatcher, cls.WrappedMatcher);
  PathMatcher.prototype.match = function (target) {
    if (target.strings.hasOwnProperty("filepath")) {
      const clone = target.clone();
      clone.keys = ["filepath"];
      return this.matcher.match(clone);
    }
  };
  PathMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchFilePath(); };
  PathMatcher.prototype.requiredInputs = function () { return {}; };
  cls.PathMatcher = PathMatcher;
  return PathMatcher;
}

/** file: — restricts the inner matcher to the "filename" string. */
export function defineFileMatcher(host) {
  function FileMatcher(matcher) {
    const self = cls.WrappedMatcher.call(this, matcher) || this;
    return self;
  }
  inherit(FileMatcher, cls.WrappedMatcher);
  FileMatcher.prototype.match = function (target) {
    if (target.strings.hasOwnProperty("filename")) {
      const clone = target.clone();
      clone.keys = ["filename"];
      return this.matcher.match(clone);
    }
  };
  FileMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchFileName(); };
  FileMatcher.prototype.requiredInputs = function () { return {}; };
  cls.FileMatcher = FileMatcher;
  return FileMatcher;
}

/** content: — restricts the inner matcher to the "content" string. */
export function defineContentMatcher(host) {
  function ContentMatcher(matcher) {
    const self = cls.WrappedMatcher.call(this, matcher) || this;
    return self;
  }
  inherit(ContentMatcher, cls.WrappedMatcher);
  ContentMatcher.prototype.match = function (target) {
    if (target.strings.hasOwnProperty("content")) {
      const clone = target.clone();
      clone.keys = ["content"];
      return this.matcher.match(clone);
    }
  };
  ContentMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchContent(); };
  ContentMatcher.prototype.requiredInputs = function () { return { content: true }; };
  cls.ContentMatcher = ContentMatcher;
  return ContentMatcher;
}

/** -x: negation — inverts a definitive yes/no of the inner matcher (undefined stays undefined). */
export function defineNotMatcher(host) {
  function NotMatcher(matcher) {
    const self = cls.WrappedMatcher.call(this, matcher) || this;
    return self;
  }
  inherit(NotMatcher, cls.WrappedMatcher);
  NotMatcher.prototype.match = function (target) {
    const result = this.matcher.match(target);
    if (result !== undefined) return result ? null : {};
  };
  NotMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelExcluding(); };
  cls.NotMatcher = NotMatcher;
  return NotMatcher;
}

// =====================================================================================================================
// Leaf matchers
// =====================================================================================================================

/** Bare /regex/: matches the regex against every key of the target. */
export function defineRegexMatcher(host) {
  function RegexMatcher(regex) {
    const self = cls.SearchMatcherBase.call(this) || this;
    self.regex = regex;
    return self;
  }
  inherit(RegexMatcher, cls.SearchMatcherBase);
  RegexMatcher.prototype.match = function (target) {
    if (this.regex === "") return null;
    const re = cachedRegExp(this.regex, target.caseSensitive);
    let matched = false;
    const result = {};
    for (const key of target.keys) {
      const ranges = regexMatchRanges(re, target.strings[key], false);
      if (ranges.length > 0) {
        result[key] = ranges;
        matched = true;
      }
    }
    return matched ? result : null;
  };
  RegexMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchRegex() + "/" + this.regex + "/"; };
  RegexMatcher.prototype.requiredInputs = function () { return { content: true }; };
  cls.RegexMatcher = RegexMatcher;
  return RegexMatcher;
}

/** Quoted "exact text": whole-word match on content, plain substring match on the other keys. */
export function defineQuotedTextMatcher(host) {
  function QuotedTextMatcher(text) {
    const self = cls.SearchMatcherBase.call(this) || this;
    self.text = text;
    self.wholeWordRegex = wholeWordPattern(text);
    self.partialMatchRegex = escapeRegExpQuery(text);
    return self;
  }
  inherit(QuotedTextMatcher, cls.SearchMatcherBase);
  QuotedTextMatcher.prototype.match = function (target) {
    if (this.text === "") return undefined;
    let matched = false;
    const result = {};
    for (const key of target.keys) {
      if (key === "propertyName") {
        if (target.strings[key].toLowerCase() === this.text.toLowerCase()) {
          result[key] = [[0, this.text.length]];
          matched = true;
        }
        continue;
      }
      let wholeWord = false;
      let source = this.partialMatchRegex;
      if (key === "content") {
        wholeWord = true;
        source = this.wholeWordRegex;
      }
      const ranges = regexMatchRanges(cachedRegExp(source, target.caseSensitive), target.strings[key], wholeWord);
      if (ranges.length > 0) {
        result[key] = ranges;
        matched = true;
      }
    }
    return matched ? result : null;
  };
  QuotedTextMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchExactText() + '"' + this.text + '"'; };
  QuotedTextMatcher.prototype.requiredInputs = function () { return { content: true }; };
  cls.QuotedTextMatcher = QuotedTextMatcher;
  return QuotedTextMatcher;
}

/** Bare text: regex search over the keys; an exact (case-insensitive) hit on propertyName. */
export function defineTextMatcher(host) {
  function TextMatcher(text) {
    const self = cls.RegexMatcher.call(this, escapeRegExpQuery(text)) || this;
    self.text = text;
    return self;
  }
  inherit(TextMatcher, cls.RegexMatcher);
  TextMatcher.prototype.setText = function (text) {
    this.text = text;
    this.regex = escapeRegExpQuery(text);
  };
  TextMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchText() + '"' + this.text + '"'; };
  TextMatcher.prototype.match = function (target) {
    return this.text === "" ? null : cls.RegexMatcher.prototype.match.call(this, target);
  };
  cls.TextMatcher = TextMatcher;
  return TextMatcher;
}

/** Matches everything (the empty alternative inside parentheses). */
export function defineEmptyMatcher(host) {
  function EmptyMatcher() {
    const self = cls.SearchMatcherBase.apply(this, arguments) || this;
    return self;
  }
  inherit(EmptyMatcher, cls.SearchMatcherBase);
  EmptyMatcher.prototype.match = function (target) {
    const result = {};
    for (const key of target.keys) {
      if (target.strings[key]) result[key] = [[0, 0]];
    }
    return result;
  };
  EmptyMatcher.prototype.getInfo = function () { return ""; };
  EmptyMatcher.prototype.requiredInputs = function () { return {}; };
  cls.EmptyMatcher = EmptyMatcher;
  return EmptyMatcher;
}

/** > / < comparison against the property value a [key:value] matcher stashed on the target. */
export function defineCompareMatcher(host) {
  function CompareMatcher(type, matcher) {
    const self = cls.SearchMatcherBase.call(this) || this;
    self.type = type;
    if (matcher instanceof cls.TextMatcher) self.text = matcher.text;
    else {
      if (!(matcher instanceof cls.QuotedTextMatcher)) {
        throw new Error(type + " operator cannot be applied to matcher " + matcher.getInfo());
      }
      self.text = matcher.text;
    }
    return self;
  }
  inherit(CompareMatcher, cls.SearchMatcherBase);
  CompareMatcher.prototype.match = function (target) {
    const value = target.getData(COMPARE_VALUE);
    if (value == null) return null;
    if ((this.type === "lessthan" && value < this.text) || (this.type === "greaterthan" && value > this.text)) {
      return { content: [[0, String(value).length]] };
    }
    return null;
  };
  CompareMatcher.prototype.getInfo = function () {
    return this.type === "lessthan"
      ? host.t.plugins.search.labelMatchLessThan() + this.text
      : host.t.plugins.search.labelMatchGreaterThan() + this.text;
  };
  CompareMatcher.prototype.requiredInputs = function () { return {}; };
  cls.CompareMatcher = CompareMatcher;
  return CompareMatcher;
}

/** TRUE / FALSE / EMPTY: compares the property value stashed on the target. */
export function defineBooleanMatcher(host) {
  function BooleanMatcher(word) {
    const self = cls.SearchMatcherBase.call(this) || this;
    self.expected = null;
    if (word === "TRUE") self.expected = true;
    else if (word === "FALSE") self.expected = false;
    return self;
  }
  inherit(BooleanMatcher, cls.SearchMatcherBase);
  BooleanMatcher.prototype.match = function (target) {
    const value = target.getData(COMPARE_VALUE);
    return value === this.expected ? { content: [[0, String(value).length]] } : null;
  };
  BooleanMatcher.prototype.getInfo = function () {
    return this.expected === true ? host.t.plugins.search.labelMatchTrue()
      : this.expected === false ? host.t.plugins.search.labelMatchFalse()
      : host.t.plugins.search.labelMatchEmpty();
  };
  BooleanMatcher.prototype.requiredInputs = function () { return {}; };
  cls.BooleanMatcher = BooleanMatcher;
  return BooleanMatcher;
}

/** [key] or [key:value]: searches the frontmatter properties of the file. */
export function definePropertyMatcher(host) {
  function PropertyMatcher(key, value) {
    const self = cls.SearchMatcherBase.call(this) || this;
    self.key = key;
    self.value = value;
    return self;
  }
  inherit(PropertyMatcher, cls.SearchMatcherBase);
  PropertyMatcher.prototype.match = function (target) {
    const frontmatter = target.cache ? target.cache.frontmatter : undefined;
    if (!frontmatter) return null;
    const matchedKeys = [];
    for (const name in frontmatter) {
      if (!frontmatter.hasOwnProperty(name)) continue;
      const keyTarget = target.clone();
      keyTarget.keys = ["propertyName"];
      keyTarget.strings.propertyName = name;
      if (this.key.match(keyTarget)) matchedKeys.push(name);
    }
    const results = [];
    for (const name of matchedKeys) {
      if (this.value !== null) {
        const values = frontmatter[name];
        if (Array.isArray(values)) {
          for (let i = 0; i < values.length; i++) {
            const valueTarget = target.cloneForPropertyContent(values[i]);
            const result = this.value.match(valueTarget);
            if (result && result.content) {
              for (const range of mergeSpans(result.content)) results.push({ key: name, subkey: [i], pos: range });
            }
          }
        } else {
          const valueTarget = target.cloneForPropertyContent(values);
          const result = this.value.match(valueTarget);
          if (result && result.content) {
            for (const range of result.content) results.push({ key: name, pos: range });
          }
        }
      } else {
        results.push({ key: name });
      }
    }
    return results.length > 0 ? { properties: results } : null;
  };
  PropertyMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchProperty(); };
  PropertyMatcher.prototype.requiredInputs = function () { return {}; };
  PropertyMatcher.prototype.getContext = function (pos) {
    let context = this.key.getContext(pos);
    if (!context && this.value) context = this.value.getContext(pos);
    if (context) {
      context.matcherStack.push(this);
      return context;
    }
    return cls.SearchMatcherBase.prototype.getContext.call(this, pos);
  };
  cls.PropertyMatcher = PropertyMatcher;
  return PropertyMatcher;
}

// =====================================================================================================================
// Content-splitting matchers (line / block / section / task)
// =====================================================================================================================

/** line:(...) — the inner matcher runs inside single lines only. */
export function defineLineMatcher(host) {
  function LineMatcher(matcher) {
    const self = cls.SplitContentMatcher.call(this, matcher) || this;
    return self;
  }
  inherit(LineMatcher, cls.SplitContentMatcher);
  LineMatcher.prototype.match = function (target) {
    if (!target.strings.hasOwnProperty("content")) return;
    const content = target.strings.content;
    return this.splitContentMatch(target, (clone, yieldPiece) => {
      let offset = 0;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        yieldPiece(line, offset);
        offset += line.length + 1;
      }
    });
  };
  LineMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchLine(); };
  LineMatcher.prototype.requiredInputs = function () { return { content: true }; };
  cls.LineMatcher = LineMatcher;
  return LineMatcher;
}

/** block:(...) — the inner matcher runs inside document sections and list items of the parsed content. */
export function defineBlockMatcher(host) {
  function BlockMatcher(matcher) {
    const self = cls.SplitContentMatcher.call(this, matcher) || this;
    return self;
  }
  inherit(BlockMatcher, cls.SplitContentMatcher);
  BlockMatcher.prototype.match = function (target) {
    if (!target.strings.hasOwnProperty("content")) return;
    const cache = target.cache;
    if (!cache) return null;
    const content = target.strings.content;
    return this.splitContentMatch(target, (clone, yieldPiece) => {
      if (cache.sections) {
        for (const section of cache.sections) {
          if (section.type === "list") continue;
          const start = section.position.start.offset;
          const end = section.position.end.offset;
          yieldPiece(content.substring(start, end), start);
        }
      }
      if (cache.listItems) {
        for (const item of cache.listItems) {
          const start = item.position.start.offset;
          const end = item.position.end.offset;
          yieldPiece(content.substring(start, end), start);
        }
      }
    });
  };
  BlockMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchBlock(); };
  BlockMatcher.prototype.requiredInputs = function () { return { content: true }; };
  cls.BlockMatcher = BlockMatcher;
  return BlockMatcher;
}

/** section:(...) — the inner matcher runs inside heading sections (a heading plus everything until the next same-or-higher one). */
export function defineSectionMatcher(host) {
  function SectionMatcher(matcher) {
    const self = cls.SplitContentMatcher.call(this, matcher) || this;
    return self;
  }
  inherit(SectionMatcher, cls.SplitContentMatcher);
  SectionMatcher.prototype.match = function (target) {
    if (!target.strings.hasOwnProperty("content")) return;
    const cache = target.cache;
    if (!cache) return null;
    const state = target.getData(SECTION_STATE);
    const headings = cache.headings;
    if (!headings) {
      if (state) return null;
      target.setData(SECTION_STATE, { sections: null, index: 0 });
      const result = this.matcher.match(target);
      target.deleteData(SECTION_STATE);
      return result;
    }
    const original = target.original;
    let sections;
    let index;
    let end;
    let baseOffset = 0;
    if (state) {
      sections = state.sections;
      const current = sections[state.index];
      if (current.children === 0) return null;
      baseOffset = current.start;
      index = state.index + 1;
      end = Math.min(sections.length, index + current.children);
    } else {
      sections = headingSections(headings, original.length);
      index = 0;
      end = sections.length;
    }
    return this.splitContentMatch(target, (clone, yieldPiece) => {
      for (let i = index; i < end; i++) {
        const section = sections[i];
        const start = section.start;
        const stop = section.end;
        if (stop <= start) continue;
        clone.setData(SECTION_STATE, { sections, index: i });
        yieldPiece(original.substring(start, stop), start - baseOffset);
      }
    });
  };
  SectionMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchSection(); };
  SectionMatcher.prototype.requiredInputs = function () { return { content: true }; };
  cls.SectionMatcher = SectionMatcher;
  return SectionMatcher;
}

/** Turns the flat heading list into {start,end,children} sections (children = deeper headings nested inside). */
function headingSections(headings, contentLength) {
  const sections = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const next = headings[i + 1];
    const start = heading.position.start.offset;
    if (i === 0 && start > 0) sections.push({ start: 0, end: start, children: 0 });
    const end = next ? next.position.start.offset : contentLength;
    let children = 0;
    for (let j = i + 1; j < headings.length && headings[j].level > heading.level; j++) children++;
    sections.push({ start, end, children });
  }
  return sections;
}

/** task: / task-todo: / task-done: — the inner matcher runs inside task list items only. */
export function defineTaskMatcher(host) {
  function TaskMatcher(matcher, completed) {
    let inner = matcher;
    if (inner instanceof cls.QuotedTextMatcher && inner.text === "") inner = new cls.EmptyMatcher();
    const self = cls.SplitContentMatcher.call(this, inner) || this;
    self.completed = completed;
    return self;
  }
  inherit(TaskMatcher, cls.SplitContentMatcher);
  TaskMatcher.prototype.match = function (target) {
    if (!target.strings.hasOwnProperty("content")) return;
    const cache = target.cache;
    if (!cache) return null;
    const content = target.strings.content;
    const completed = this.completed;
    return this.splitContentMatch(target, (clone, yieldPiece) => {
      if (cache.listItems) {
        for (const item of cache.listItems) {
          if (item.task === undefined) continue;
          if (typeof completed === "boolean" && completed !== (item.task !== " ")) continue;
          const start = item.position.start.offset;
          const end = item.position.end.offset;
          yieldPiece(content.substring(start, end), start);
        }
      }
    });
  };
  TaskMatcher.prototype.getInfo = function () {
    const completed = this.completed;
    return completed === true ? host.t.plugins.search.labelMatchTaskDone()
      : completed === false ? host.t.plugins.search.labelMatchTaskTodo()
      : host.t.plugins.search.labelMatchTask();
  };
  TaskMatcher.prototype.requiredInputs = function () { return { content: true }; };
  cls.TaskMatcher = TaskMatcher;
  return TaskMatcher;
}

/** tag:(...) — matches against the tag string plus inline #tags and frontmatter tags of the content. */
export function defineTagMatcher(host) {
  function TagMatcher(matcher) {
    const self = cls.SearchMatcherBase.call(this) || this;
    if (matcher.text.charAt(0) !== "#") matcher.setText("#" + matcher.text);
    self.matcher = matcher;
    return self;
  }
  inherit(TagMatcher, cls.SearchMatcherBase);
  TagMatcher.prototype.match = function (target) {
    const tagRe = new RegExp("^" + this.matcher.regex + "($|\\/)", "i");
    if (target.strings.hasOwnProperty("tag") && tagRe.test(target.strings.tag)) return {};
    if (target.strings.hasOwnProperty("content")) {
      const cache = target.cache;
      if (!cache) return null;
      let properties;
      const contentRanges = [];
      let matched = false;
      const frontmatterList = frontmatterTags(cache.frontmatter);
      if (frontmatterList) {
        const key = keyIgnoringCase(cache.frontmatter, "tags");
        for (const tag of frontmatterList) {
          if (tagRe.test(tag)) {
            matched = true;
            properties = [{ key }];
          }
        }
      }
      const inlineTags = cache.tags;
      if (inlineTags) {
        for (const tag of inlineTags) {
          if (tagRe.test(tag.tag)) {
            contentRanges.push([tag.position.start.offset, tag.position.end.offset]);
            matched = true;
          }
        }
      }
      return matched ? { content: contentRanges, properties } : null;
    }
  };
  TagMatcher.prototype.getInfo = function () { return host.t.plugins.search.labelMatchTag() + this.matcher.text; };
  TagMatcher.prototype.requiredInputs = function () { return { content: true }; };
  TagMatcher.prototype.getContext = function (pos) {
    const context = this.matcher.getContext(pos);
    if (context) {
      context.matcherStack.push(this);
      return context;
    }
    return cls.SearchMatcherBase.prototype.getContext.call(this, pos);
  };
  cls.TagMatcher = TagMatcher;
  return TagMatcher;
}

// =====================================================================================================================
// Groups
// =====================================================================================================================

/** AND: every sub-matcher must match; a definitive null fails the group, partial results merge. */
export function defineAndGroup(host) {
  function AndGroup(matchers) {
    const self = cls.MultiMatcher.call(this, matchers) || this;
    return self;
  }
  inherit(AndGroup, cls.MultiMatcher);
  AndGroup.prototype.match = function (target) {
    let result;
    for (const matcher of this.matchers) {
      const partial = matcher.match(target);
      if (partial === null) return null;
      if (result) {
        if (partial) mergeMatchResults(result, partial);
      } else result = partial;
    }
    return result;
  };
  AndGroup.prototype.getInfo = function () { return host.t.plugins.search.labelMatchAll(); };
  cls.AndGroup = AndGroup;
  return AndGroup;
}

/** OR: sub-matchers vote; the first defined result wins and later defined ones merge into it. */
export function defineOrGroup(host) {
  function OrGroup(matchers) {
    const self = cls.MultiMatcher.call(this, matchers) || this;
    return self;
  }
  inherit(OrGroup, cls.MultiMatcher);
  OrGroup.prototype.match = function (target) {
    let result;
    for (const matcher of this.matchers) {
      const partial = matcher.match(target);
      if (result || partial === undefined) {
        if (partial) mergeMatchResults(result, partial);
      } else result = partial;
    }
    return result;
  };
  OrGroup.prototype.getInfo = function () { return host.t.plugins.search.labelMatchAny(); };
  cls.OrGroup = OrGroup;
  return OrGroup;
}

// =====================================================================================================================
// Operator table
// =====================================================================================================================

/** The named operators a query can use; `operate` wraps the parsed operand matcher. */
export function defineSearchOperators(host) {
  return {
    "match-case": { operate: (inner) => new cls.CaseMatcher(inner, true) },
    "ignore-case": { operate: (inner) => new cls.CaseMatcher(inner, false) },
    path: { exclusive: true, operate: (inner) => new cls.PathMatcher(inner) },
    file: { exclusive: true, operate: (inner) => new cls.FileMatcher(inner) },
    content: { exclusive: true, operate: (inner) => new cls.ContentMatcher(inner) },
    line: { exclusive: true, operate: (inner) => new cls.LineMatcher(inner) },
    block: { exclusive: true, operate: (inner) => new cls.BlockMatcher(inner) },
    section: { exclusive: true, allowSelf: true, operate: (inner) => new cls.SectionMatcher(inner) },
    task: { exclusive: true, operate: (inner) => new cls.TaskMatcher(inner, undefined) },
    "task-todo": { exclusive: true, operate: (inner) => new cls.TaskMatcher(inner, false) },
    "task-done": { exclusive: true, operate: (inner) => new cls.TaskMatcher(inner, true) },
    tag: {
      exclusive: true,
      operate: (inner) => {
        if (!(inner instanceof cls.TextMatcher)) throw new Error('Operator "tag" can only be followed by text');
        return new cls.TagMatcher(inner);
      },
    },
  };
}

// =====================================================================================================================
// SearchQuery
// =====================================================================================================================

/** A parsed query: match(file, content) / matchContent / matchTag / matchFilepath -> result map | null | {}. */
export function defineSearchQuery(host) {
  function SearchQuery(app, query, caseSensitive, ops) {
    this.app = app;
    this.query = query;
    this.caseSensitive = caseSensitive;
    const operatorTable = ops || host.SearchOperators;
    const tokens = tokenizeQuery(query);
    const matcher = buildMatcher(tokens, operatorTable);
    this.matcher = matcher;
    this.requiredInputs = matcher && matcher.requiredInputs();
  }

  SearchQuery.prototype.match = function (file, content) {
    const app = this.app;
    if (file.extension === "canvas" && app.internalPlugins.getEnabledPluginById("canvas")) {
      let parsed;
      try { parsed = JSON.parse(content); } catch (error) {}
      if (parsed && Array.isArray(parsed.nodes)) {
        let matched = false;
        const result = {};
        const textNodes = parsed.nodes.filter((node) => node.type === "text");
        const canvasPlugin = app.internalPlugins.getEnabledPluginById("canvas");
        const index = canvasPlugin.index.get(file);
        for (const node of textNodes) {
          const nodeTarget = new cls.SearchTarget(
            { filename: file.name, filepath: file.path, content: node.text },
            node.text, ["content"], this.caseSensitive);
          nodeTarget.cache = index ? index.caches[node.id] : undefined;
          const partial = this._match(nodeTarget);
          if (partial !== null) {
            matched = true;
            if (partial) result["canvas-" + node.id] = partial.content;
          }
        }
        const fileTarget = new cls.SearchTarget(
          { content: "", filename: file.name, filepath: file.path }, "", ["content", "filename"], this.caseSensitive);
        const fileResult = this._match(fileTarget);
        if (fileResult !== null) {
          matched = true;
          if (fileResult && fileResult.filename) result.filename = fileResult.filename;
        }
        if (matched) return result;
      }
    }
    const strings = { filename: file.name, filepath: file.path, content };
    const keys = [];
    if (extensionWithoutContent(file.extension)) keys.push("filename");
    if (file.extension === "md") keys.push("content");
    const target = new cls.SearchTarget(strings, content, keys, this.caseSensitive);
    if (file.extension === "md") target.cache = app.metadataCache.getFileCache(file);
    return this._match(target);
  };

  SearchQuery.prototype.matchContent = function (content) {
    return this._match(new cls.SearchTarget({ content }, content, ["content"], this.caseSensitive));
  };

  SearchQuery.prototype.matchTag = function (tag) {
    return this._match(new cls.SearchTarget({ tag }, tag, ["tag"], this.caseSensitive));
  };

  SearchQuery.prototype.matchFilepath = function (path) {
    return this._match(new cls.SearchTarget({ filename: lastSegment(path), filepath: path }, path, ["filename"], this.caseSensitive));
  };

  SearchQuery.prototype._match = function (target) {
    resetRegexCaches();
    const result = this.matcher.match(target);
    if (result) {
      for (const key of RESULT_KEYS) {
        if (result.hasOwnProperty(key)) result[key] = mergeSpans(result[key]);
      }
    }
    return result === undefined ? {} : result;
  };

  cls.SearchQuery = SearchQuery;
  return SearchQuery;
}
