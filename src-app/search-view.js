// The global search view and everything it renders: the results container (virtualised through the shared tree
// scroller), one item per file, one item per match context line, one per frontmatter property hit, the incremental
// search queue (worker-paced file iteration), the "copy results" modal and the input suggest (operators, property
// keys, tags, paths, recent searches).
//
// Match result objects come from the query engine (search-query.js): { filename?, filepath?, content?, tag?,
// propertyName? } -> [[start,end], ...] ranges plus a `properties` list for frontmatter hits.

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { mergeSpans } from "./search-simple.js";
import { prepareFuzzyFinder } from "./search-simple.js";
import { newlinesBefore } from "./text.js";
import { setElementTooltip } from "./tooltip.js";
import { cancelTransition } from "./animation.js";
import { animateCollapse, expandFromZero, mountChildren, markItemCollapsed, makeTreePusher, nextVisibleTreeItem, prevVisibleTreeItem, lastVisibleTreeItem, scheduleIdle } from "./tree.js";
import { searchClasses, tokenizeQuery, buildMatcher, tokenEnd } from "./search-query.js";

const V = {};
// Live registry of every results/view class defined below; sibling own modules (link panes, bookmarks, tags) build on them.
export const searchViewClasses = V;

// Case-insensitive, numeric-aware text comparison (the same collator the file explorer sorts with).
const searchTextCollator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
export function compareSearchText(a, b) { return searchTextCollator.compare(a, b); }

// The keys a match result may carry (same list the query engine merges on).
const MATCH_KEYS = ["filename", "filepath", "content", "propertyName", "tag"];

// Regexes used to expand a match to its surrounding line / paragraph for the context display.
const TASK_LINE_RE = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/;
const BLANK_LINE_RE = /\r?\n\r?\n/y;

// =====================================================================================================================
// Small helpers
// =====================================================================================================================

/** How many ranges a match result holds across all keys (plus property hits). */
export function countSearchMatches(match) {
  let count = 0;
  for (const key of MATCH_KEYS) {
    if (match[key]) count += match[key].length;
  }
  if (match.properties) count += match.properties.length;
  return count;
}

/**
 * Renders `text` into `el` as plain spans, wrapping every [start,end) range of `matches` (clipped to [from,to])
 * in a `.search-result-file-matched-text` span. `from`/`to` select the visible window; unmatched gaps stay plain.
 */
export function renderMatchRanges(el, text, from, to, matches) {
  const emit = (isMatch, start, end) => {
    const piece = text.substring(start, end);
    if (isMatch) el.createSpan({ cls: "search-result-file-matched-text", text: piece });
    else el.createSpan({ text: piece });
  };
  let cursor = from;
  for (const range of matches) {
    const start = range[0];
    if (start >= to) break;
    let end = range[1];
    if (end < from) continue;
    if (start < from) start = from;
    if (end > to) end = to;
    if (start > cursor) emit(false, cursor, start);
    emit(true, start, end);
    cursor = end;
  }
  if (cursor < to) emit(false, cursor, to);
}

/** Binary search: index of the item whose position range contains `offset` (or the insertion edge). */
export function indexOfPositionOffset(list, offset, preferEnd) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) / 2 | 0;
    const cmp = offset < list[mid].position.start.offset ? 1 : offset > list[mid].position.end.offset ? -1 : 0;
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid;
  }
  return preferEnd ? hi : lo;
}

/** Middle-click on a result must not start the autoscroll; swallow it. */
export function preventMiddleClick(el) {
  el.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
}

/**
 * Expands a match range to a readable context: the whole line(s) it sits on, or — when the line is too long —
 * up to `maxDist` chars around it, snapped to the surrounding paragraph/task block. Returns [start, end, clippedStart, clippedEnd].
 */
export function contextLineBounds(content, range, maxDist = 100) {
  let start = range[0] - 1;
  let back = 0;
  while (back < maxDist && start >= 0) {
    if (content.charAt(start) === "\n") break;
    start--;
    back++;
  }
  start++;
  const clippedStart = back === maxDist;
  let end = range[1];
  let forward = 0;
  while (forward < maxDist && end < content.length) {
    if (content.charAt(end) === "\n") break;
    end++;
    forward++;
  }
  return [start, end, clippedStart, forward === maxDist];
}

/** The file comparator for a sort order name (unknown names fall back to alphabetical). */
export function sortOrderComparator(order) {
  if (!SEARCH_SORT_ORDERS.hasOwnProperty(order)) order = "alphabetical";
  return SEARCH_SORT_ORDERS[order];
}

export const SEARCH_SORT_ORDERS = {
  alphabetical: (a, b) => compareSearchText(a.basename, b.basename),
  alphabeticalReverse: (a, b) => -SEARCH_SORT_ORDERS.alphabetical(a, b),
  byModifiedTime: (a, b) => b.stat.mtime - a.stat.mtime,
  byModifiedTimeReverse: (a, b) => -SEARCH_SORT_ORDERS.byModifiedTime(a, b),
  byCreatedTime: (a, b) => b.stat.ctime - a.stat.ctime,
  byCreatedTimeReverse: (a, b) => -SEARCH_SORT_ORDERS.byCreatedTime(a, b),
};

/** The dropdown groups of sort orders (pairs of normal/reverse). */
export const SEARCH_SORT_GROUPS = [
  ["alphabetical", "alphabeticalReverse"],
  ["byModifiedTime", "byModifiedTimeReverse"],
  ["byCreatedTime", "byCreatedTimeReverse"],
];

/** Display label for a sort order (file-explorer wording, shared with the explorer). */
export function searchSortLabel(key) {
  const labels = __basaltHost.t.plugins.fileExplorer;
  return {
    alphabetical: labels.labelSortAToZ(),
    alphabeticalReverse: labels.labelSortZToA(),
    byModifiedTime: labels.labelSortNewToOld(),
    byModifiedTimeReverse: labels.labelSortOldToNew(),
    byCreatedTime: labels.labelSortCreatedNewToOld(),
    byCreatedTimeReverse: labels.labelSortCreatedOldToNew(),
  }[key];
}

/** Shows or hides `el`, animating the height change when `animate` (used for collapse/expand of result groups). */
export async function toggleElementVisibility(el, hide, animate) {
  cancelTransition(el);
  if (hide) {
    if (animate) await animateCollapse(el);
    el.hide();
  } else {
    el.show();
    if (animate) await expandFromZero(el);
  }
}

/** A deferredSearch promise ({promise, resolve, reject}) — the queue sleeps on these between batches. */
function deferredSearch() {
  const d = { promise: null, resolve: null, reject: null };
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
  return d;
}

/**
 * Paces an async iteration: yields every item of `iterable`, and every `batchSize` items checks whether more than
 * `duration` ms elapsed; then calls `beforePause(now)` and idles up to `maxDelay` ms so the UI can breathe.
 */
export async function* batchedIteration(iterable, options = {}) {
  const batchSize = options.batchSize === undefined ? 10 : options.batchSize;
  const duration = options.duration === undefined ? 5 : options.duration;
  const maxDelay = options.maxDelay === undefined ? 100 : options.maxDelay;
  const beforePause = options.beforePause;
  let count = 0;
  let last = performance.now();
  for await (const item of iterable) {
    yield item;
    count++;
    if (count % batchSize === 0) {
      const now = performance.now();
      if (now - last > duration) {
        if (beforePause) beforePause(now);
        await new Promise((resolve) => scheduleIdle(resolve, maxDelay));
        last = performance.now();
      }
    }
  }
}

/**
 * Streams the queued vault files through the query: skips ignored/unsupported files, reads content for
 * markdown/canvas when the query needs it, paces itself through batchedIteration and stops on cancel.
 */
export async function runSearchOverFiles(app, requiredInputs, queue, callback, options) {
  for await (const file of batchedIteration(queue.generator(), options)) {
    if (app.metadataCache.isUserIgnored(file.path)) continue;
    if (!app.metadataCache.isSupportedFile(file)) continue;
    const needsContent = file.extension === "md" || file.extension === "canvas";
    let content = "";
    if (needsContent && requiredInputs && requiredInputs.content) {
      try {
        content = await app.vault.cachedRead(file);
      } catch (error) {
        console.error(error);
      }
    }
    if (queue.runnable.isCancelled()) return;
    await callback(file, content);
  }
}

// =====================================================================================================================
// The file queue: a pausable, cancellable work queue the search view feeds with vault files.
// =====================================================================================================================

/** Minimal ring buffer over an array (the queue drains from the front without shifting). */
class OffsetQueue {
  constructor() {
    this.queue = [];
    this.offset = 0;
  }
  get() { return this.queue; }
  get length() { return this.queue.length - this.offset; }
  isEmpty() { return this.queue.length === 0; }
  enqueue(item) { this.queue.push(item); }
  enqueueArray(items) { for (const item of items) this.queue.push(item); }
  remove(item) {
    for (let i = this.queue.length - 1; i >= this.offset; i--) {
      if (this.queue[i] === item) this.queue.splice(i, 1);
    }
  }
  clear() { this.queue = []; this.offset = 0; }
  dequeue() {
    const queue = this.queue;
    const offset = this.offset;
    if (queue.length === 0) return undefined;
    const item = queue[offset];
    queue[offset] = undefined;
    let next = offset + 1;
    if (2 * next >= queue.length) {
      this.queue = queue.slice(next);
      next = 0;
    }
    this.offset = next;
    return item;
  }
  peek() { return this.queue.length > 0 ? this.queue[this.offset] : undefined; }
}

/** Run-state flags with start/stop/cancel callbacks (the queue's onStart/onStop/onCancel wiring). */
class SearchRunnable {
  constructor(options = {}) {
    this.running = false;
    this.cancelled = false;
    this.onStart = options.onStart || null;
    this.onStop = options.onStop || null;
    this.onCancel = options.onCancel || null;
  }
  start() {
    if (this.running) return;
    this.running = true;
    if (this.onStart) this.onStart();
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.onStop) this.onStop();
  }
  cancel() {
    this.stop();
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.onCancel) this.onCancel();
  }
  isRunning() { return this.running; }
  isCancelled() { return this.cancelled; }
}

/** The queue itself: items in, one at a time out through `generator()`; `notify()` wakes a sleeping consumer. */
export function defineFileQueue() {
  function FileQueue(options) {
    this.items = new OffsetQueue();
    this.promise = null;
    this.runnable = new SearchRunnable(options);
  }
  FileQueue.prototype.addList = function (files) {
    this.items.enqueueArray(files);
    this.notify();
  };
  FileQueue.prototype.add = function (file) {
    this.items.enqueue(file);
    this.notify();
  };
  FileQueue.prototype.remove = function (file) { this.items.remove(file); };
  FileQueue.prototype.clear = function () { this.items.clear(); };
  FileQueue.prototype.notify = function () {
    const pending = this.promise;
    if (pending) {
      this.promise = null;
      setTimeout(() => { if (pending) pending.resolve(); }, 0);
    }
  };
  FileQueue.prototype.cancel = function () { this.runnable.cancel(); };
  FileQueue.prototype.generator = async function* () {
    const runnable = this.runnable;
    for (;;) {
      if (runnable.isCancelled()) return;
      if (this.items.length !== 0) {
        runnable.start();
        yield await this.items.dequeue();
        continue;
      }
      runnable.stop();
      await (this.promise = deferredSearch()).promise;
    }
  };
  V.FileQueue = FileQueue;
  return FileQueue;
}

// =====================================================================================================================
// Search results DOM
// =====================================================================================================================

/** One context line of matches inside a file result (`.search-result-file-match` with show-more buttons). */
export function defineSearchMatchResult(host) {
  function SearchMatchResult(parentDom, content, cache, start, end, matches, mutateEState) {
    this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    this.onMatchRender = null;
    this.parentDom = parentDom;
    this.content = content;
    this.cache = cache;
    this.start = start;
    this.end = end;
    this.matches = matches;
    this.mutateEState = mutateEState;
    const el = (this.el = createDiv("search-result-file-match tappable"));
    this.showMoreBeforeEl = el.createDiv("search-result-hover-button mod-top", (button) => {
      host.setIcon(button, "lucide-chevron-up");
      setElementTooltip(button, host.t.plugins.search.labelMoreContext(), { placement: "top" });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.showMoreBefore();
      });
    });
    this.showMoreAfterEl = el.createDiv("search-result-hover-button mod-bottom", (button) => {
      host.setIcon(button, "lucide-chevron-down");
      setElementTooltip(button, host.t.plugins.search.labelMoreContext(), { placement: "bottom" });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.showMoreAfter();
      });
    });
    this.showMoreBeforeEl.hide();
    this.showMoreAfterEl.hide();
    preventMiddleClick(el);
    el.onClickEvent(this.onResultClick.bind(this));
    el.addEventListener("mouseover", this.onFocusEnter.bind(this));
    el.addEventListener("mouseout", this.onFocusExit.bind(this));
    el.addEventListener("contextmenu", (event) => parentDom.onResultContextMenu(event));
  }
  const proto = SearchMatchResult.prototype;

  proto.onResultClick = function (event) {
    if (event.instanceOf(MouseEvent) && event.button !== 0 && event.button !== 1) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    const eState = { match: { content: this.content, matches: this.matches } };
    if (this.mutateEState) this.mutateEState.call(this, eState);
    const parent = this.parentDom;
    parent.app.workspace.getLeaf(host.Keymap.isModEvent(event)).openFile(parent.file, { eState });
  };

  proto.onFocusExit = function (event) {
    if (event && event.instanceOf(MouseEvent) && !host.pointerEntered(event, this.el)) return;
    if (!this.el.classList.contains("has-focus")) {
      this.showMoreBeforeEl.hide();
      this.showMoreAfterEl.hide();
    }
  };

  proto.onFocusEnter = function (event) {
    if (event && event.instanceOf(MouseEvent)) {
      if (!host.pointerEntered(event, this.el)) return;
      this.parentDom.onResultMouseover(event, this.el, this.matches);
    }
    this.toggleShowMoreContextButtons();
  };

  proto.toggleShowMoreContextButtons = function () {
    this.showMoreBeforeEl.toggle(this.start > 0);
    this.showMoreAfterEl.toggle(this.end < this.content.length);
  };

  /** Widens the window to the previous block boundary (list item / section start / previous line run). */
  proto.showMoreBefore = function () {
    let pos = this.start;
    while (pos > 0) {
      pos--;
      const prev = this.getPrevPos(pos);
      if (prev < pos) {
        pos = prev;
        break;
      }
    }
    this.start = pos;
    this.render();
    this.onFocusEnter();
  };

  /** Widens the window to the next block boundary. */
  proto.showMoreAfter = function () {
    let pos = this.end;
    const length = this.content.length;
    while (pos < length) {
      pos++;
      const next = this.getNextPos(pos);
      if (next > pos) {
        pos = next;
        break;
      }
    }
    this.end = pos;
    this.render();
    this.onFocusEnter();
  };

  /** Start of the block (list item or section) containing offset `pos`, or the previous line start. */
  proto.getPrevPos = function (pos) {
    const content = this.content;
    const cache = this.cache;
    const listItems = cache.listItems;
    const sections = cache.sections;
    if (listItems) {
      const item = listItems[indexOfPositionOffset(listItems, pos, true)];
      if (item) {
        const position = item.position;
        const start = position.start;
        const end = position.end;
        if (start.offset - start.col <= pos && end.offset >= pos) return start.offset - start.col;
      }
    }
    if (sections) {
      const section = sections[indexOfPositionOffset(sections, pos, true)];
      if (section && section.type !== "list") {
        const position = section.position;
        const start = position.start;
        const end = position.end;
        if (start.offset - start.col <= pos && end.offset >= pos) return start.offset - start.col;
      }
    }
    let i = pos;
    while (i > 0 && content.charCodeAt(i - 1) !== 10) i--;
    return i;
  };

  /** End of the block (list item run or section) containing offset `pos`, or the next line end. */
  proto.getNextPos = function (pos) {
    const content = this.content;
    const cache = this.cache;
    const listItems = cache.listItems;
    const sections = cache.sections;
    if (listItems) {
      const index = indexOfPositionOffset(listItems, pos, true);
      const item = listItems[index];
      if (item) {
        const position = item.position;
        const start = position.start;
        const end = position.end;
        if (start.offset - start.col <= pos && end.offset >= pos) {
          // extend over the following items of the same parent (the rest of the list)
          let last = item;
          const parents = new Set();
          parents.add(item.position.start.line);
          let i = index + 1;
          while (i < listItems.length) {
            const next = listItems[i];
            if (!parents.has(next.parent)) break;
            parents.add(next.position.start.line);
            i++;
            last = next;
          }
          return last.position.end.offset;
        }
      }
    }
    if (sections) {
      const index = indexOfPositionOffset(sections, pos, true);
      const section = sections[index];
      if (section && section.type !== "list") {
        const position = section.position;
        const start = position.start;
        const end = position.end;
        if (start.offset - start.col <= pos && end.offset >= pos) return end.offset;
      }
    }
    let i = pos;
    while (i < content.length && content.charCodeAt(i) !== 10) i++;
    return i;
  };

  proto.render = function (before, after) {
    const el = this.el;
    const content = this.content;
    el.empty();
    if (before) el.appendText("...");
    renderMatchRanges(el, content, this.start, this.end, this.matches);
    el.appendChild(this.showMoreBeforeEl);
    el.appendChild(this.showMoreAfterEl);
    if (after) el.appendText("...");
    if (this.onMatchRender) this.onMatchRender(this.matches[0], el);
    this.parentDom.parentDom.infinityScroll.invalidate(this);
  };

  V.SearchMatchResult = SearchMatchResult;
  return SearchMatchResult;
}

/** One frontmatter property hit inside a file result (`key: value` with the matched value highlighted). */
export function defineSearchPropertyResult(host) {
  function SearchPropertyResult(parentDom, cache, matches) {
    this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    this.onMatchRender = null;
    this.parentDom = parentDom;
    this.cache = cache;
    this.matches = matches;
    const el = (this.el = createDiv("search-result-file-match tappable"));
    preventMiddleClick(el);
    el.onClickEvent(this.onResultClick.bind(this));
    el.addEventListener("mouseover", this.onFocusEnter.bind(this));
    el.addEventListener("mouseout", this.onFocusExit.bind(this));
    el.addEventListener("contextmenu", (event) => parentDom.onResultContextMenu(event));
  }
  const proto = SearchPropertyResult.prototype;

  proto.onResultClick = function (event) {
    if (event.instanceOf(MouseEvent) && event.button !== 0 && event.button !== 1) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    const eState = { propertyMatches: this.matches };
    const parent = this.parentDom;
    parent.app.workspace.getLeaf(host.Keymap.isModEvent(event)).openFile(parent.file, { eState });
  };

  proto.onFocusExit = function (event) {
    if (event && event.instanceOf(MouseEvent) && !host.pointerEntered(event, this.el)) return;
    if (!this.el.classList.contains("has-focus")) return;
  };

  proto.onFocusEnter = function (event) {
    if (!event || !event.instanceOf(MouseEvent) || !host.pointerEntered(event, this.el)) return;
  };

  proto.render = function () {
    const el = this.el;
    const parent = this.parentDom;
    const matches = this.matches;
    el.empty();
    const key = matches[0].key;
    el.createSpan({ text: key + ": " });
    const value = ((this.cache.frontmatter !== null && this.cache.frontmatter !== undefined ? this.cache.frontmatter : {})[key]);
    if (Array.isArray(value)) {
      const renderItem = (index) => {
        const item = value[index];
        if (!item) return;
        const text = String(item);
        const sub = matches.filter((m) => m.pos && (m.subkey == null ? undefined : m.subkey[0]) === index);
        const ranges = mergeSpans(sub.map((m) => m.pos));
        renderMatchRanges(el, text, 0, text.length, ranges);
        el.createSpan({ text: " " });
      };
      for (let i = 0; i < value.length; i++) renderItem(i);
    } else {
      const text = String(value);
      const ranges = mergeSpans(matches.map((m) => m.pos).filter(Boolean));
      renderMatchRanges(el, text, 0, text.length, ranges);
    }
    parent.parentDom.infinityScroll.invalidate(this);
  };

  V.SearchPropertyResult = SearchPropertyResult;
  return SearchPropertyResult;
}

/** The positions (with a little context) that a content match should display: the list item / section it sits in. */
function matchDisplayPositions(content, match, cache) {
  const listItems = cache.listItems;
  const sections = cache.sections;
  if (listItems) {
    const index = indexOfPositionOffset(listItems, match[0], true);
    const item = listItems[index];
    if (item && match[0] >= item.position.start.offset && match[1] <= item.position.end.offset) {
      // widen to the whole run of sibling items (the rest of the list block)
      let last = item;
      const parents = new Set();
      parents.add(item.position.start.line);
      let i = index + 1;
      while (i < listItems.length) {
        const next = listItems[i];
        if (!parents.has(next.parent)) break;
        parents.add(next.position.start.line);
        i++;
        last = next;
      }
      return [item.position.start.offset - item.position.start.col, last.position.end.offset];
    }
  }
  if (sections) {
    const section = sections[indexOfPositionOffset(sections, match[0], true)];
    if (section && match[0] >= section.position.start.offset && match[1] <= section.position.end.offset) {
      return [section.position.start.offset, section.position.end.offset];
    }
  }
  // fall back to a ~1000-char window around the match start, extended over task lines / paragraphs
  const limit = 1000;
  let from = match[0];
  const fromLimit = from - limit;
  while (from > 0 && from > fromLimit && content.charCodeAt(from - 1) !== 10) from--;
  let to = match[0];
  const toLimit = to + limit;
  while (to < content.length && to < toLimit && content.charCodeAt(to) !== 10) to++;
  const windowText = content.substring(from, to);
  const taskMatch = windowText.match(TASK_LINE_RE);
  if (taskMatch && taskMatch[2]) {
    // inside a task/list item: extend over the following more-indented lines
    let end = to;
    while (end < content.length) {
      let lineEnd = content.indexOf("\n", end + 1);
      if (lineEnd === -1) lineEnd = content.length;
      const nextMatch = content.substring(end + 1, lineEnd).match(TASK_LINE_RE);
      if (nextMatch && nextMatch[1].length <= taskMatch[1].length) break;
      end = lineEnd;
    }
    return [from, end];
  }
  // extend over the surrounding blank-line-delimited paragraph
  while (from > 0 && from > fromLimit && !paragraphBreakAt(content, from)) from--;
  while (content.charCodeAt(from) === 10 && from < match[0]) from++;
  while (to < content.length && to < toLimit && !paragraphBreakAt(content, to)) to++;
  return [from, to];
}

/** Sticky-regex test for a blank-line boundary at the given index. */
function paragraphBreakAt(content, index) {
  BLANK_LINE_RE.lastIndex = index;
  return BLANK_LINE_RE.test(content);
}

/** One file's search result: title row (path + match count) plus the list of match context items. */
export function defineSearchFileResult(host) {
  function SearchFileResult(app, parentDom, file, result, content, showTitle = true) {
    this.onMatchRender = null;
    this.collapsible = true;
    this.collapsed = false;
    this.extraContext = true;
    this.showTitle = showTitle;
    this.separateMatches = false;
    this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    this.vChildren = new host.TreeChildren(this);
    this.pusherEl = makeTreePusher();
    this.rendered = false;
    this.app = app;
    this.parentDom = parentDom;
    this.file = file;
    this.result = result;
    this.content = content;
    this.showTitle = showTitle;
    const el = (this.el = this.containerEl = createDiv("tree-item search-result"));
    if (showTitle) {
      const selfEl = (this.selfEl = el.createDiv("tree-item-self search-result-file-title is-clickable"));
      const collapseEl = (this.collapseEl = selfEl.createDiv("tree-item-icon collapse-icon"));
      host.setIcon(collapseEl, "right-triangle");
      collapseEl.style.visibility = "hidden";
      preventMiddleClick(selfEl);
      selfEl.onClickEvent(this.onResultClick.bind(this));
      selfEl.addEventListener("mouseover", (event) => this.onResultMouseover(event, selfEl));
      selfEl.addEventListener("contextmenu", this.onResultContextMenu.bind(this));
      collapseEl.addEventListener("click", this.onCollapseClick.bind(this));
      const inner = selfEl.createDiv("tree-item-inner");
      if (result.filename || result.filepath) {
        let path;
        let ranges;
        if (result.filepath) {
          path = file.path;
          ranges = result.filepath;
          if (result.filename) {
            const base = file.path.length - file.name.length;
            for (const range of result.filename) {
              ranges.push([range[0] + base, range[1] + base]);
            }
            ranges = mergeSpans(ranges);
          }
        } else {
          path = file.name;
          ranges = result.filename;
          if (file.extension === "md" && (ranges.length === 0 || ranges[ranges.length - 1][1] <= file.basename.length)) {
            path = file.basename;
          }
        }
        renderMatchRanges(inner, path, 0, path.length, ranges);
      } else {
        inner.setText(file.extension === "md" ? file.basename : file.name);
      }
      const count = countSearchMatches(Object.assign({}, result, { filename: undefined }));
      if (count > 0) {
        selfEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair").setText(String(count));
      }
      const dragManager = this.app.dragManager;
      dragManager.handleDrag(selfEl, (event) => dragManager.dragFile(event, this.file));
    }
    this.childrenEl = el.createDiv("search-result-file-matches");
  }
  const proto = SearchFileResult.prototype;

  proto.onRender = function () {
    if (this.rendered) return;
    this.rendered = true;
    this.renderContentMatches();
  };

  /** (Re)builds the match items from the result: content ranges as context lines, properties as key rows. */
  proto.renderContentMatches = function () {
    const self = this;
    const file = this.file;
    const result = this.result;
    const content = this.content;
    const collapsible = this.collapsible;
    const extraContext = this.extraContext;
    const separateMatches = this.separateMatches;
    const collapseEl = this.collapseEl;
    this.vChildren.clear();
    if (this.showTitle) collapseEl.style.visibility = "hidden";
    let hasMatches = false;

    const addContentMatches = (ranges, text, cache, mutate) => {
      ranges.sort((a, b) => a[0] - b[0]);
      hasMatches = true;
      let index = 0;
      const emit = (start, end, before, after, stateMutate) => {
        let count = index + 1;
        if (!separateMatches) {
          while (count < ranges.length) {
            const next = ranges[count];
            if (next[0] >= end) break;
            if (next[1] > end) {
              end = next[1];
              count++;
              break;
            }
            count++;
          }
        }
        const group = ranges.slice(index, count);
        const item = new V.SearchMatchResult(self, text, cache, start, end, group, stateMutate);
        item.onMatchRender = self.onMatchRender;
        item.render(before, after);
        self.vChildren.addChild(item);
        index = count;
      };
      while (index < ranges.length) {
        const match = ranges[index];
        if (extraContext) {
          const positions = self.getMatchExtraPositions(text, match, cache);
          emit(positions[0], positions[1]);
        } else {
          const positions = contextLineBounds(text, match);
          emit(positions[0], positions[1], positions[2], positions[3]);
        }
      }
    };

    if (file.extension === "canvas" && content) {
      try {
        const nodes = JSON.parse(content).nodes
          .filter((node) => node.type === "text")
          .sort((a, b) => a.y - b.y || a.x - b.x);
        const index = this.app.internalPlugins.getEnabledPluginById("canvas").index.get(file);
        for (const node of nodes) {
          const key = "canvas-" + node.id;
          if (result.hasOwnProperty(key)) {
            const nodeResult = result[key];
            if (nodeResult && nodeResult.length > 0) {
              addContentMatches(nodeResult, node.text, (index && index.caches[node.id]) || {}, (state) => { state.match.nodeId = node.id; });
            }
          }
        }
      } catch (error) {}
    } else {
      const cache = this.app.metadataCache.getFileCache(file) || {};
      if (result.properties && result.properties.length > 0) {
        // group property hits by key, one row per key
        const byKey = {};
        for (const hit of result.properties) {
          if (!byKey.hasOwnProperty(hit.key)) byKey[hit.key] = [];
          byKey[hit.key].push(hit);
        }
        hasMatches = true;
        for (const key of Object.keys(byKey)) {
          const item = new V.SearchPropertyResult(self, cache, byKey[key]);
          item.onMatchRender = self.onMatchRender;
          item.render();
          self.vChildren.addChild(item);
        }
      }
      if (result.content && result.content.length > 0) {
        addContentMatches(result.content, content, cache);
      }
    }
    if (this.showTitle && collapsible && hasMatches) collapseEl.style.visibility = "";
    this.invalidate();
  };

  /** The display window for a content match: its list item / section when known, else a context line window. */
  proto.getMatchExtraPositions = function (text, match, cache) {
    return matchDisplayPositions(text, match, cache);
  };

  proto.onCollapseClick = function (event) {
    event.preventDefault();
    if (host.Keymap.isModifier(event, "Mod")) this.parentDom.setCollapseAll(!this.collapsed);
    else this.setCollapse(!this.collapsed, true);
  };

  proto.onResultClick = function (event) {
    if (event.instanceOf(MouseEvent) && event.button !== 0 && event.button !== 1) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.app.workspace.getLeaf(host.Keymap.isModEvent(event)).openFile(this.file, {
      eState: {
        match: { content: this.content, matches: this.result.content || [] },
        propertyMatches: this.result.properties,
      },
    });
  };

  /** Hover preview: resolves the file link under the cursor with the match's scroll position. */
  proto.onResultMouseover = function (event, targetEl, matches) {
    if (event.defaultPrevented || !host.pointerEntered(event, targetEl)) return;
    event.preventDefault();
    const linktext = this.file.path;
    let state = null;
    if (matches && matches.length > 0) {
      state = { scroll: newlinesBefore(this.content, matches[0][0]) };
    }
    this.app.workspace.trigger("hover-link", {
      event,
      source: "search",
      hoverParent: this.parentDom,
      targetEl,
      linktext,
      state,
    });
  };

  proto.onResultContextMenu = function (event) {
    const self = this;
    const menu = new host.Menu().addSections(["title", "open", "action-primary", "action", "info", "view", "system", "", "danger"]);
    if (this.app.workspace.handleLinkContextMenu(menu, this.file.path, "")) {
      event.preventDefault();
      if (this.selfEl && this.selfEl.contains(event.targetNode)) {
        menu.addItem((item) => item
          .setSection("danger")
          .setTitle(host.t.interface.menu.deleteFile())
          .setIcon("lucide-trash-2")
          .setWarning(true)
          .onClick(() => this.app.fileManager.promptForDeletion(this.file)));
      }
      menu.setParentElement(this.containerEl).showAtMouseEvent(event);
    }
  };

  proto.setCollapse = async function (collapsed, animate) {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    markItemCollapsed(this.containerEl, collapsed);
    await mountChildren(this.childrenEl, this.containerEl, collapsed, animate);
    this.invalidate();
  };

  proto.setCollapsible = function (collapsible) {
    if (this.collapsible === collapsible) return;
    this.collapsible = collapsible;
    this.collapseEl.style.visibility = collapsible ? "" : "hidden";
  };

  proto.setExtraContext = function (extraContext) {
    if (this.extraContext === extraContext) return;
    this.extraContext = extraContext;
    this.renderContentMatches();
  };

  proto.invalidate = function () {
    this.parentDom.infinityScroll.invalidate(this, true);
  };

  V.SearchFileResult = SearchFileResult;
  return SearchFileResult;
}

// =====================================================================================================================
// Results container
// =====================================================================================================================

/** The virtualised list of file results under the search input (`.search-result-container`). */
export function defineSearchResults(host) {
  function SearchResults(app, el, emptyText, scrollParent) {
    this.changed = debounceCall(this.onChange.bind(this), 0);
    this.infinityScroll = null;
    this.vChildren = new host.TreeChildren(this);
    this.resultDomLookup = new Map();
    this.focusedItem = null;
    this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    this.pusherEl = makeTreePusher();
    this.emptyStateEl = null;
    this.showingEmptyState = false;
    this.working = false;
    this.sortOrder = "alphabetical";
    this.collapseAll = false;
    this.extraContext = false;
    this.app = app;
    this.el = el;
    this.emptyStateEl = createDiv({ cls: "search-empty-state", text: emptyText });
    this.childrenEl = this.el.createDiv("search-results-children");
    const scroller = (this.infinityScroll = new host.InfinityScroll(scrollParent || this.el));
    scroller.rootEl = this;
    scroller.setWidth = false;
  }
  const proto = SearchResults.prototype;

  proto.startLoader = function () {
    this.working = true;
    this.el.addClass("is-loading");
    this.onChange();
  };

  proto.stopLoader = function () {
    this.working = false;
    this.el.removeClass("is-loading");
    this.onChange();
  };

  proto.onChange = function () {
    const children = this.vChildren;
    const empty = this.emptyStateEl;
    const scroller = this.infinityScroll;
    const compare = sortOrderComparator(this.sortOrder);
    children.sort((a, b) => compare(a.file, b.file));
    if (!children.hasChildren() && !this.working) this.el.appendChild(empty);
    else empty.detach();
    scroller.queueCompute();
  };

  proto.emptyResults = function () {
    this.vChildren.clear();
    this.resultDomLookup.clear();
    this.changed();
  };

  proto.getResult = function (file) { return this.resultDomLookup.get(file); };

  proto.removeResult = function (file) {
    const item = this.resultDomLookup.get(file);
    if (item) {
      this.vChildren.removeChild(item);
      this.resultDomLookup.delete(file);
      this.changed();
      const focused = this.focusedItem;
      if (focused && (focused === item || focused.parent === item)) this.setFocusedItem(null);
    }
    return item;
  };

  proto.addResult = function (file, result, content, showTitle = true) {
    if (!file) return;
    const previous = this.removeResult(file);
    const item = new V.SearchFileResult(this.app, this, file, result, content, showTitle);
    if (previous) item.setCollapse(previous.collapsed, false);
    else item.setCollapse(this.collapseAll, false);
    item.extraContext = this.extraContext;
    this.vChildren.addChild(item);
    this.resultDomLookup.set(file, item);
    this.changed();
    return item;
  };

  proto.toggle = function (hide, animate) {
    return toggleElementVisibility(this.el, hide, animate).then(() => {
      if (!hide) this.infinityScroll.invalidateAll();
    });
  };

  proto.setCollapseAll = function (collapsed) {
    this.collapseAll = collapsed;
    for (const item of this.vChildren.children) item.setCollapse(collapsed, false);
    this.infinityScroll.invalidateAll();
  };

  proto.setExtraContext = function (extraContext) {
    this.extraContext = extraContext;
    for (const item of this.vChildren.children) item.setExtraContext(extraContext);
    this.infinityScroll.invalidateAll();
  };

  proto.onResize = function () { this.infinityScroll.onResize(); };

  proto.getFiles = function () { return this.vChildren.children.map((item) => item.file); };

  proto.getMatchCount = function () {
    let count = 0;
    for (const item of this.vChildren.children) count += countSearchMatches(item.result);
    return count;
  };

  proto.setFocusedItem = function (item) {
    if (this.focusedItem) {
      this.focusedItem.el.removeClass("has-focus");
      if (this.focusedItem instanceof V.SearchMatchResult) this.focusedItem.onFocusExit();
    }
    this.focusedItem = item;
    if (item) {
      item.el.addClass("has-focus");
      this.infinityScroll.scrollIntoView(item);
      if (item instanceof V.SearchMatchResult) item.onFocusEnter();
    }
  };

  proto.changeFocusedItem = function (direction) {
    if (this.focusedItem !== null) {
      const next = direction === "forwards"
        ? nextVisibleTreeItem(this.focusedItem, true)
        : prevVisibleTreeItem(this.focusedItem, true);
      if (next) this.setFocusedItem(next);
    } else {
      const first = direction === "forwards"
        ? this.vChildren.first()
        : lastVisibleTreeItem(this, true);
      this.setFocusedItem(first);
    }
  };

  V.SearchResults = SearchResults;
  return SearchResults;
}

// =====================================================================================================================
// The search view
// =====================================================================================================================

/** The global search leaf (`view type "search"`): input, options, results and keyboard navigation. */
export function defineSearchView(host) {
  const t = () => host.t.plugins.search;

  function SearchView(leaf) {
    const self = host.View.call(this, leaf) || this;
    self.icon = "lucide-search";
    self.searchContainerEl = null;
    self.searchInfoEl = null;
    self.infoEl = null;
    self.resultCountEl = null;
    self.matchingCase = false;
    self.explainSearch = false;
    self.showParams = false;
    self.searchQuery = null;
    self.requestSaveSearch = debounceCall(self.saveSearch.bind(self), 5000, true);

    const containerEl = self.containerEl;
    const resultsEl = createDiv("search-result-container mod-global-search");
    self.dom = new V.SearchResults(self.app, resultsEl, t().labelNoMatches());

    const startSearchDebounced = debounceCall(self.startSearch.bind(self), 0);
    const row = containerEl.createDiv("search-row");
    self.searchComponent = new host.SearchComponent(row)
      .setPlaceholder(t().promptStartSearch())
      .setClass("global-search-input-container")
      .addRightDecorator((el) => {
        self.matchingCaseButtonEl = el;
        setElementTooltip(el, t().labelMatchCase());
        host.setIcon(el, "uppercase-lowercase-a");
        el.addClass("clickable-icon");
        el.addEventListener("click", () => self.setMatchingCase(!self.matchingCase));
      })
      .onChange((value) => {
        self.dom.setFocusedItem(null);
        self.stopSearch();
        if (value) startSearchDebounced();
        else {
          self.startSearch();
          self.infoEl.hide();
        }
      })
      .then((component) => {
        setElementTooltip(component.clearButtonEl, t().tooltipClearSearch());
        component.inputEl.addEventListener("keypress", (event) => {
          if (event.isComposing || event.key !== "Enter") return;
          if (!host.Platform.hasPhysicalKeyboard) host.blurAndClearSelection();
          self.startSearch();
        });
        if (host.Platform.isMobile) {
          component.containerEl.createDiv("search-input-suggest-button", (button) => {
            host.setIcon(button, "right-triangle");
            button.addEventListener("click", () => V.SearchSuggest.showOnce(self.app, component.inputEl, true));
          });
        }
      });

    self.searchInfoEl = containerEl.createDiv({ cls: "search-info-container" });
    self.searchInfoEl.hide();
    self.filterSectionToggleEl = row.createDiv("clickable-icon", (el) => {
      setElementTooltip(el, t().labelToggleSearchSettings());
      host.setIcon(el, "lucide-sliders-horizontal");
      el.addEventListener("click", () => self.toggleFilterSection());
    });
    self.searchParamsContainerEl = containerEl.createDiv("search-params", (el) => {
      new host.Setting(el).setName(t().labelCollapseResults()).setClass("mod-toggle").addToggle((toggle) => {
        self.collapseResultsToggle = toggle;
        toggle.onChange((value) => self.setCollapseAll(value));
      });
      new host.Setting(el).setName(t().labelMoreContext()).setClass("mod-toggle").addToggle((toggle) => {
        self.extraContextToggle = toggle;
        toggle.onChange((value) => self.setExtraContext(value));
      });
      new host.Setting(el).setName(t().labelExplainSearchTerm()).setClass("mod-toggle").addToggle((toggle) => {
        self.explainSearchToggle = toggle;
        toggle.onChange((value) => self.setExplainSearch(value));
      });
    });
    self.searchParamsContainerEl.hide();

    self.infoEl = containerEl.createDiv("search-results-info", (el) => {
      el.createDiv("clickable-icon search-results-result-count", (countEl) => {
        self.resultCountEl = countEl.createSpan();
        countEl.createDiv("more-options-icon", (icon) => host.setIcon(icon, "lucide-more-horizontal"));
        countEl.addEventListener("click", (event) => {
          if (countEl.classList.contains("has-active-menu")) return;
          const menu = new host.Menu().addSections(["action"]).addItem((item) => item
            .setSection("action")
            .setIcon("lucide-copy")
            .setTitle(t().labelCopySearchResults())
            .onClick(self.onCopyResultsClick.bind(self)));
          self.app.workspace.trigger("search:results-menu", menu, self);
          menu.setParentElement(countEl).showAtMouseEvent(event);
        });
      });
      const dropdown = (self.sortOrderDropdown = new host.DropdownComponent(el).onChange((value) => {
        self.setSortOrder(value);
        self.app.workspace.requestSaveLayout();
      }));
      for (const group of SEARCH_SORT_GROUPS) {
        for (const key of group) dropdown.addOption(key, searchSortLabel(key));
      }
      dropdown.setValue("alphabetical");
    });
    self.infoEl.hide();
    self.containerEl.appendChild(resultsEl);

    self.scope = new host.Scope(self.app.scope);
    self.scope.register([], "Enter", self.onKeyEnterInFocus.bind(self));
    self.scope.register(["Mod"], "Enter", self.onKeyEnterInFocus.bind(self));
    self.scope.register([], "ArrowDown", self.onKeyArrowDownInFocus.bind(self));
    self.scope.register([], "ArrowUp", self.onKeyArrowUpInFocus.bind(self));
    self.scope.register([], "ArrowLeft", self.onKeyArrowLeftInFocus.bind(self));
    self.scope.register([], "ArrowRight", self.onKeyArrowRightInFocus.bind(self));
    self.scope.register(["Shift"], "ArrowUp", self.onKeyShowMoreBefore.bind(self));
    self.scope.register(["Shift"], "ArrowDown", self.onKeyShowMoreAfter.bind(self));

    self.queue = new V.SearchQueueComponent(self.app, self.dom);
    self.addChild(self.queue);
    if (!host.Platform.isMobile) V.SearchSuggest.attach(self.app, self.searchComponent.inputEl, true);
    return self;
  }
  inherit(SearchView, host.View);
  const proto = SearchView.prototype;

  proto.onOpen = async function () {
    this.registerDomEvent(this.leaf.tabHeaderEl, "click", this.onTabHeaderClick.bind(this));
    await host.View.prototype.onOpen.call(this);
  };

  proto.toggleFilterSection = function () {
    this.showParams = !this.showParams;
    this.filterSectionToggleEl.toggleClass("is-active", this.showParams);
    this.searchParamsContainerEl.toggle(this.showParams);
  };

  /** Remembers the query in the recent-searches list (kept to 20, newest first). */
  proto.saveSearch = function () {
    const query = this.searchComponent.getValue();
    if (!query) return;
    let recent = this.app.loadLocalStorage("recent-searches");
    if (!recent || !Array.isArray(recent)) recent = [];
    recent.remove(query);
    recent.unshift(query);
    if (recent.length > 20) recent = recent.slice(0, 20);
    this.app.saveLocalStorage("recent-searches", recent);
  };

  proto.getDisplayText = function () { return t().name(); };

  proto.getViewType = function () { return "search"; };

  proto.getState = function () {
    const state = host.View.prototype.getState.call(this);
    state.query = this.getQuery();
    state.matchingCase = this.matchingCase;
    state.explainSearch = this.explainSearch;
    state.collapseAll = this.dom.collapseAll;
    state.extraContext = this.dom.extraContext;
    state.sortOrder = this.dom.sortOrder;
    return state;
  };

  proto.setState = async function (state, result) {
    await host.View.prototype.setState.call(this, state, result);
    const { query, matchingCase, explainSearch, collapseAll, extraContext, sortOrder } = state;
    if (String.isString(query) || query === null) this.setQuery(query);
    if (isBoolean(matchingCase)) this.setMatchingCase(matchingCase);
    if (isBoolean(explainSearch)) this.explainSearchToggle.setValue(explainSearch);
    if (isBoolean(collapseAll)) this.collapseResultsToggle.setValue(collapseAll);
    if (isBoolean(extraContext)) this.extraContextToggle.setValue(extraContext);
    if (String.isString(sortOrder) && SEARCH_SORT_ORDERS.hasOwnProperty(sortOrder)) {
      this.sortOrderDropdown.setValue(sortOrder);
      this.setSortOrder(sortOrder);
    }
  };

  proto.setEphemeralState = function (state) {
    host.View.prototype.setEphemeralState.call(this, state);
    if (state.focus) {
      const input = this.searchComponent.inputEl;
      input.setSelectionRange(0, input.value.length);
      input.focus({ preventScroll: true });
    }
  };

  proto.setMatchingCase = function (matchingCase) {
    if (matchingCase === this.matchingCase) return;
    this.matchingCase = matchingCase;
    this.matchingCaseButtonEl.toggleClass("is-active", matchingCase);
    this.app.workspace.requestSaveLayout();
    if (this.searchComponent.getValue() !== "") this.startSearch();
  };

  proto.setExplainSearch = function (explain) {
    if (explain === this.explainSearch) return;
    this.explainSearch = explain;
    this.searchInfoEl.toggle(explain);
    this.app.workspace.requestSaveLayout();
  };

  proto.setCollapseAll = function (collapsed) {
    if (collapsed === this.dom.collapseAll) return;
    this.dom.setCollapseAll(collapsed);
    this.app.workspace.requestSaveLayout();
  };

  proto.setExtraContext = function (extraContext) {
    if (extraContext === this.dom.extraContext) return;
    this.dom.setExtraContext(extraContext);
    this.app.workspace.requestSaveLayout();
  };

  proto.onCopyResultsClick = function (event) {
    event.preventDefault();
    new V.CopyResultsModal(this.app, this.dom).open();
  };

  proto.onKeyEnterInFocus = function (event) {
    const item = this.dom.focusedItem;
    if (item && (item instanceof V.SearchMatchResult || item instanceof V.SearchFileResult)) item.onResultClick(event);
  };

  proto.onKeyArrowUpInFocus = function (event) {
    event.preventDefault();
    this.dom.changeFocusedItem("backwards");
  };

  proto.onKeyArrowDownInFocus = function (event) {
    if (event.defaultPrevented) return;
    event.preventDefault();
    host.blurAndClearSelection();
    this.dom.changeFocusedItem("forwards");
  };

  proto.onKeyArrowLeftInFocus = function (event) {
    if (this.searchComponent.inputEl.isActiveElement()) return;
    event.preventDefault();
    const item = this.dom.focusedItem;
    if (item instanceof V.SearchFileResult) {
      item.setCollapse(true, true);
    } else if (item && item.parent instanceof V.SearchFileResult) {
      item.parent.setCollapse(true, true);
      let top = item;
      while (top.parent && top.parent.collapsed) top = top.parent;
      this.dom.setFocusedItem(top);
    } else if (item === this.dom.infinityScroll.rootEl) {
      this.dom.setCollapseAll(true);
    }
  };

  proto.onKeyArrowRightInFocus = function (event) {
    if (this.searchComponent.inputEl.isActiveElement()) return;
    event.preventDefault();
    if (this.dom.focusedItem === this.dom.infinityScroll.rootEl) this.dom.setCollapseAll(false);
    else if (this.dom.focusedItem instanceof V.SearchFileResult) this.dom.focusedItem.setCollapse(false, true);
  };

  proto.onKeyShowMoreBefore = function (event) {
    if (this.dom.focusedItem instanceof V.SearchMatchResult) this.dom.focusedItem.showMoreBefore();
  };

  proto.onKeyShowMoreAfter = function (event) {
    if (this.dom.focusedItem instanceof V.SearchMatchResult) this.dom.focusedItem.showMoreAfter();
  };

  proto.setSortOrder = function (order) {
    this.dom.sortOrder = order;
    this.dom.changed();
  };

  proto.onResize = function () { this.dom.onResize(); };

  /** Parses the query and kicks off the incremental file search (results stream in through the queue). */
  proto.startSearch = function () {
    const self = this;
    this.stopSearch();
    const app = this.app;
    const dom = this.dom;
    const infoEl = this.searchInfoEl;
    dom.emptyResults();
    this.dom.setFocusedItem(null);
    try {
      const query = this.searchComponent.getValue();
      const searchQuery = new searchClasses.SearchQuery(app, query, this.matchingCase);
      if (!searchQuery.matcher) return;
      this.searchQuery = searchQuery;
      this.renderSearchInfo(searchQuery.matcher, infoEl);
      let shown = false;
      const updateCount = () => {
        self.resultCountEl.setText(t().labelResultCount({ count: dom.getMatchCount() }));
      };
      const queue = this.queue.start({
        onStop: updateCount,
      });
      this.infoEl.show();
      runSearchOverFiles(app, searchQuery.requiredInputs, queue, (file, content) => {
        return (async () => {
          const result = searchQuery.match(file, content);
          if (result) dom.addResult(file, result, content);
          else dom.removeResult(file);
          if (!shown || dom.el.isShown()) return;
          await new Promise((resolve) => dom.el.onNodeInserted(resolve, true));
        })();
      }, {
        beforePause: () => {
          shown = dom.el.isShown();
          updateCount();
        },
      });
    } catch (error) {
      infoEl.createDiv({ cls: "search-info", text: error.message });
      console.log(error);
    }
    this.app.workspace.requestSaveLayout();
    this.requestSaveSearch();
  };

  proto.stopSearch = function () {
    this.queue.stop();
    this.searchInfoEl.empty();
  };

  /** The "explain search" panel: the matcher tree rendered as nested info rows. */
  proto.renderSearchInfo = function (matcher, el) {
    const self = this;
    el.createDiv({ text: matcher.getInfo() });
    if (matcher instanceof searchClasses.MultiMatcher) {
      const children = el.createDiv("search-info-children");
      for (const sub of matcher.matchers) this.renderSearchInfo(sub, children);
    } else if (matcher instanceof searchClasses.WrappedMatcher) {
      const children = el.createDiv("search-info-children");
      this.renderSearchInfo(matcher.matcher, children);
    } else if (matcher instanceof searchClasses.PropertyMatcher) {
      el.createDiv("search-info-children", (box) => {
        box.createSpan({ text: "Key:" });
        box.createDiv("search-info-children", (keyEl) => self.renderSearchInfo(matcher.key, keyEl));
        if (matcher.value) {
          box.createSpan({ text: "Value:" });
          box.createDiv("search-info-children", (valueEl) => self.renderSearchInfo(matcher.value, valueEl));
        }
      });
    }
  };

  proto.setQuery = function (query) {
    const component = this.searchComponent;
    const input = component.inputEl;
    if (String.isString(query)) {
      input.value = query;
      component.setValue(query);
    }
    this.startSearch();
  };

  proto.getQuery = function () { return this.searchComponent.getValue(); };

  proto.onTabHeaderClick = function () { this.searchComponent.autoSelect(); };

  V.SearchView = SearchView;
  return SearchView;
}

// =====================================================================================================================
// Search queue component (vault events -> incremental re-search)
// =====================================================================================================================

/** Component owning the FileQueue: (re)starts it with the vault's files, keeps it fed on vault events. */
export function defineSearchQueueComponent(host) {
  function SearchQueueComponent(app, dom) {
    const self = host.Component.call(this) || this;
    self.queue = null;
    self.app = app;
    self.dom = dom;
    return self;
  }
  inherit(SearchQueueComponent, host.Component);
  const proto = SearchQueueComponent.prototype;

  proto.onload = function () {
    const vault = this.app.vault;
    this.registerEvent(vault.on("create", this.onNonMarkdownFileChanged, this));
    this.registerEvent(vault.on("modify", this.onNonMarkdownFileChanged, this));
    this.registerEvent(vault.on("rename", this.onFileChanged, this));
    this.registerEvent(vault.on("delete", this.onFileDeleted, this));
    this.registerEvent(this.app.metadataCache.on("changed", this.onFileChanged, this));
  };

  proto.onunload = function () { this.stop(); };

  proto.stop = function () {
    const queue = this.queue;
    if (queue) {
      queue.cancel();
      this.queue = null;
    }
  };

  /** Starts a fresh queue over all vault files (sorted like the results list) and returns it. */
  proto.start = function (options) {
    const self = this;
    const app = this.app;
    const dom = this.dom;
    const queue = (this.queue = new V.FileQueue({
      onStart: () => {
        dom.startLoader();
        if (options && options.onStart) options.onStart();
      },
      onStop: () => {
        dom.stopLoader();
        if (options && options.onStop) options.onStop();
      },
      onCancel: () => {
        self.queue = null;
        if (options && options.onCancel) options.onCancel();
      },
    }));
    const files = app.vault.getFiles();
    const order = dom.sortOrder;
    if (order) files.sort(sortOrderComparator(order));
    queue.addList(files);
    return queue;
  };

  proto.onNonMarkdownFileChanged = function (file) {
    if (file instanceof host.TFile && file.extension !== "md") {
      if (this.queue) this.queue.add(file);
    }
  };

  proto.onFileChanged = function (file) {
    if (file instanceof host.TFile && this.queue) this.queue.add(file);
  };

  proto.onFileDeleted = function (file) {
    if (!(file instanceof host.TFile)) return;
    const queue = this.queue;
    if (queue) queue.remove(file);
    this.dom.removeResult(file);
  };

  V.SearchQueueComponent = SearchQueueComponent;
  return SearchQueueComponent;
}

// =====================================================================================================================
// Copy-results modal
// =====================================================================================================================

/** Modal that copies the current result file list (paths, wikilinks or markdown links, optional bullets/numbers). */
export function defineCopyResultsModal(host) {
  const t = () => host.t.plugins.search;

  function CopyResultsModal(app, results) {
    const self = host.Modal.call(this, app) || this;
    self.setTitle(t().labelCopySearchResults());
    const contentEl = self.contentEl;
    const options = {};
    const plugin = app.internalPlugins.getEnabledPluginById("global-search");
    if (plugin) Object.assign(options, plugin.options);
    let pathToggle;
    let linkDropdown;
    let listDropdown;
    const container = contentEl.createDiv("copy-search-result-container");
    const textarea = container.createEl("textarea", "copy-search-result-textarea");
    const refresh = () => {
      const files = results.getFiles();
      textarea.value = files.map((file, index) => {
        let text = pathToggle.getValue() ? file.path : file.getShortName();
        const linkStyle = linkDropdown.getValue();
        if (linkStyle === "wikilink") text = "[[" + text + "]]";
        else if (linkStyle === "markdown") text = "[" + file.basename + "](" + text + ")";
        const listStyle = listDropdown.getValue();
        if (listStyle === "-") text = "- " + text;
        else if (listStyle === "*") text = "* " + text;
        else if (listStyle === "num") text = (index + 1) + ". " + text;
        options.showFullPath = pathToggle.getValue();
        options.linkStyle = linkDropdown.getValue();
        options.listStyle = listDropdown.getValue();
        if (plugin) plugin.plugin.saveData(options);
        return text;
      }).join("\n");
      textarea.select();
    };
    new host.Setting(container).setName(t().optionShowPath()).setDesc(t().optionShowPathDescription()).addToggle((toggle) => {
      toggle.setValue(!!options.showFullPath).onChange(refresh);
      pathToggle = toggle;
    });
    new host.Setting(container).setName(t().optionLinkStyle()).setDesc(t().optionLinkStyleDescription()).addDropdown((dropdown) => {
      dropdown.addOption("none", t().optionChoiceLinkStyleNone())
        .addOption("wikilink", t().optionChoiceLinkStyleWikilink())
        .addOption("markdown", t().optionChoiceLinkStyleMarkdownLink())
        .setValue(options.linkStyle || "none")
        .onChange(refresh);
      linkDropdown = dropdown;
    });
    new host.Setting(container).setName(t().optionListPrefix()).setDesc(t().optionListPrefixDescription()).addDropdown((dropdown) => {
      dropdown.addOption("none", t().optionChoiceListStyleNone())
        .addOption("-", t().optionChoiceListStyleDash())
        .addOption("*", t().optionChoiceListStyleAsterisk())
        .addOption("num", t().optionChoiceListStyleNumbered())
        .setValue(options.listStyle || "none")
        .onChange(refresh);
      listDropdown = dropdown;
    });
    contentEl.createDiv("modal-button-container", (buttons) => {
      buttons.createEl("button", { text: t().buttonCopyResults(), cls: "mod-cta" }).addEventListener("click", () => {
        copyTextToClipboard(textarea.value);
        new host.Notice(t().msgSuccessfullyCopied());
      });
      buttons.createEl("button", { text: host.t.dialogue.buttonDone() }).addEventListener("click", () => self.close());
    });
    refresh();
    return self;
  }
  inherit(CopyResultsModal, host.Modal);
  V.CopyResultsModal = CopyResultsModal;
  return CopyResultsModal;
}

/** Clipboard write with the textarea fallback (same behaviour as the app's copy helper). */
export function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.permissions) {
    navigator.clipboard.writeText(text);
    return;
  }
  const textarea = activeDocument.createElement("textarea");
  textarea.value = text;
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.position = "fixed";
  activeDocument.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    activeDocument.execCommand("copy");
  } catch (error) {}
  activeDocument.body.removeChild(textarea);
}

// =====================================================================================================================
// Input suggest: operators, property keys, tags, paths, recent searches
// =====================================================================================================================

/** The operator completions shown after an empty operator context (`path:`, `tag:`, `[]`, ...). */
export function searchOperatorSuggestions(host) {
  const s = () => host.t.plugins.search;
  return [
    { type: "operator", name: "path:", token: "path:", infoTextI18n: () => s().labelPathOptionDescription() },
    { type: "operator", name: "file:", token: "file:", infoTextI18n: () => s().labelFileNameOptionDescription() },
    { type: "operator", name: "tag:", token: "tag:", infoTextI18n: () => s().labelTagOptionDescription() },
    { type: "operator", name: "line:", token: "line:()", infoTextI18n: () => s().labelLineOptionDescription() },
    { type: "operator", name: "section:", token: "section:()", infoTextI18n: () => s().labelSectionOptionDescription() },
    { type: "operator", name: "[property]", token: "[]", infoTextI18n: () => s().labelPropertyOptionDescription() },
  ];
}

/** Prepends group-header rows to a suggestion list (the `k` concat helper: headers first, then the items). */
function withGroupHeaders(headers, items) {
  return headers.concat(items);
}

const WIKI_URL = "https://github.com/FalconTechDev/basalt/wiki";

/** Autocomplete under the search input: completes operators, property keys, tags and paths from the query context. */
export function defineSearchSuggest(host) {
  const t = () => host.t.plugins.search;

  function SearchSuggest(app, inputEl, showHistory, skipListeners = false) {
    const self = host.PopoverSuggest.call(this, app) || this;
    self.inputEl = null;
    self.showHistory = true;
    self.tokens = [];
    self.inputEl = inputEl;
    self.showHistory = showHistory;
    if (!skipListeners) {
      inputEl.addEventListener("input", self.onInputChange.bind(self));
      inputEl.addEventListener("focus", self.onInputChange.bind(self));
    }
    inputEl.addEventListener("blur", self.close.bind(self));
    self.suggestEl.on("mousedown", ".suggestion-item", (event) => event.preventDefault());
    self.suggestEl.addClass("mod-search-suggestion");
    self.scope.register(["Shift"], "Enter", (event) => self.suggestions.useSelectedItem(event) && false);
    return self;
  }
  inherit(SearchSuggest, host.PopoverSuggest);
  const proto = SearchSuggest.prototype;

  proto.renderSuggestion = function (suggestion, el) {
    const self = this;
    el.addClass("mod-complex", "search-suggest-item");
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");
    const title = content.createDiv("suggestion-title");
    title.createSpan({ text: suggestion.name });
    if (suggestion.type === "operator") {
      title.createSpan({ cls: "search-suggest-info-text", text: suggestion.infoTextI18n() });
    } else if (suggestion.type === "group") {
      el.addClass("mod-group");
      title.addClass("list-item-part", "mod-extended");
      aux.createDiv("list-item-part search-suggest-icon clickable-icon", (icon) => {
        host.setIcon(icon, suggestion.icon);
        setElementTooltip(icon, suggestion.iconTooltip);
        icon.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          suggestion.callback();
          self.onInputChange();
        });
      });
    }
  };

  proto.getSuggestions = function (query) {
    const input = this.inputEl;
    if (input.selectionStart !== input.selectionEnd) return [];
    const caret = input.selectionStart;
    if (caret < query.length - 1 && query.charAt(caret) !== " ") return [];
    const tokens = (this.tokens = tokenizeQuery(query.slice(0, caret)));
    let matcher;
    try {
      matcher = buildMatcher(tokens, __basaltHost.SearchOperators);
    } catch (error) {
      return [];
    }
    const context = matcher ? matcher.getContext(caret) : null;
    let prefix = "";
    if (context) {
      const token = context.token;
      if (["quote", "text", "regex"].includes(token.type)) prefix = token.content;
      let top = context.matcherStack[0];
      if (top instanceof searchClasses.QuotedTextMatcher || top instanceof searchClasses.TextMatcher) {
        context.matcherStack.shift();
        top = context.matcherStack[0];
      }
      if (top instanceof searchClasses.PropertyMatcher) {
        if (top.value || token.type === "colon" || token.content === "]") return [];
        const finder = prepareFuzzyFinder(prefix);
        const scored = [];
        const properties = Object.keys(this.app.metadataTypeManager.getAllProperties());
        for (const name of properties) {
          const hit = finder(name);
          if (hit) scored.push({ type: "property-key", name, score: hit.score });
        }
        if (scored.length === 0) return [];
        scored.sort((a, b) => b.score - a.score);
        return withGroupHeaders([{
          type: "group",
          name: t().labelPropertiesGroup(),
          icon: "lucide-info",
          iconTooltip: t().tooltipReadMore(),
          callback: () => window.open(WIKI_URL, "_blank"),
        }], scored);
      }
      if (top instanceof searchClasses.TagMatcher) {
        const finder = prepareFuzzyFinder(prefix);
        const scored = [];
        const tags = Object.keys(this.app.metadataCache.getTags());
        tags.sort(compareSearchText);
        for (const tag of tags) {
          const hit = finder(tag.slice(1));
          if (hit) scored.push({ type: "string", name: tag, score: hit.score });
        }
        if (scored.length === 0) return [];
        scored.sort((a, b) => b.score - a.score);
        return withGroupHeaders([{
          type: "group",
          name: t().labelTagsGroup(),
          icon: "lucide-info",
          iconTooltip: t().tooltipReadMore(),
          callback: () => window.open(WIKI_URL, "_blank"),
        }], scored);
      }
      if (top instanceof searchClasses.PathMatcher) {
        const finder = prepareFuzzyFinder(prefix);
        const scored = [];
        for (const file of this.app.vault.getAllLoadedFiles()) {
          if (!(file instanceof host.TFile) && typeof file.isRoot === "function" && !file.isRoot()) {
            const hit = finder(file.path);
            if (hit) scored.push({ type: "string", name: file.path, score: hit.score });
          }
        }
        scored.sort((a, b) => b.score - a.score);
        return scored;
      }
      if (token.type === "quote") return [];
      if (context.matcherStack.length > 0) return [];
    }
    const suggestions = [];
    const operators = searchOperatorSuggestions(host).filter((op) => op.name.startsWith(prefix.toLowerCase()));
    if (operators.length > 0) {
      suggestions.push({
        type: "group",
        name: t().labelSearchOptions(),
        icon: "lucide-info",
        iconTooltip: t().tooltipReadMore(),
        callback: () => window.open(WIKI_URL, "_blank"),
      });
      suggestions.push(...operators);
    }
    if (this.showHistory && !query) {
      const recent = this.app.loadLocalStorage("recent-searches");
      if (recent && Array.isArray(recent) && recent.length > 0) {
        suggestions.push({
          type: "group",
          name: t().labelHistory(),
          icon: "lucide-x",
          iconTooltip: t().tooltipClearHistory(),
          callback: () => this.app.saveLocalStorage("recent-searches", null),
        });
        for (const entry of recent) suggestions.push({ type: "history", name: entry });
      }
    }
    return suggestions;
  };

  proto.selectSuggestion = function (suggestion, event) {
    if (suggestion.type === "group") {
      event.preventDefault();
      return;
    }
    const input = this.inputEl;
    const caret = input.selectionStart;
    const value = input.value;
    const tokens = this.tokens;
    let index = tokens.findLastIndex((token) => token.pos <= caret);
    let token = tokens[index];
    if (token && !["text", "regex", "quote"].includes(token.type)) {
      index++;
      token = tokens[index];
    }
    if (token && caret > tokenEnd(token)) token = null;
    let start = caret;
    let end = value.length;
    if (token) {
      start = token.pos;
      end = tokenEnd(token);
    }
    let insert = suggestion.name;
    if (suggestion.type === "string" && /[\[\]\(\)\s:]/.test(insert)) insert = '"' + insert + '"';
    if (suggestion.type === "property-key") {
      insert = host.Keymap.isModifier(event, "Shift") ? '"' + insert + '"] ' : '"' + insert + '":';
    }
    if (suggestion.type === "string") insert += " ";
    if (suggestion.type === "operator") insert = suggestion.token;
    let next = value.slice(0, start) + insert + value.slice(end).trimStart();
    if (suggestion.type === "string") next += " ";
    input.value = next;
    input.trigger("input");
    let cursor = start + insert.length;
    if (suggestion.type === "operator" && suggestion.token.match(/[\)\]]$/)) cursor -= 1;
    input.setSelectionRange(cursor, cursor);
    input.trigger("input");
    if (host.Platform.isMobile) this.close();
  };

  proto.onInputChange = function () {
    const input = this.inputEl;
    const value = input.value;
    const suggestions = this.getSuggestions(value);
    if (suggestions && suggestions.length > 0) {
      this.suggestions.setSuggestions(suggestions);
      if (this.suggestions.values[0].type === "group") this.suggestions.forceSetSelectedItem(1);
      this.open();
      this.suggestEl.style.width = Math.max(input.offsetWidth, 300) + "px";
      this.setAutoDestroy(input);
      this.reposition(input.getBoundingClientRect());
    } else {
      this.close();
    }
  };

  SearchSuggest.attach = function (app, inputEl, showHistory = true) {
    new V.SearchSuggest(app, inputEl, showHistory);
  };

  SearchSuggest.showOnce = function (app, inputEl, showHistory = true) {
    new V.SearchSuggest(app, inputEl, showHistory, true).onInputChange();
    inputEl.focus();
  };

  V.SearchSuggest = SearchSuggest;
  return SearchSuggest;
}

