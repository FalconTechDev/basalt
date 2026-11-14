// Community browsers: the shared list modal (search, sort, installed-only filter, detail pane with
// swipe navigation), the community plugin browser, the community theme browser and the donate dialog.
// Data feeds are the public obsidianmd/obsidian-releases JSON files (kept for wire compatibility);
// plugin/theme install goes through app.plugins / app.customCss so manifests, versions.json checks
// and vault layout stay identical to the inherited implementation.
import { inherit } from "./inherit.js";
import { hostEnv } from "./vault.js";
import { debounceCall } from "./timing.js";
import { runTransition, cancelTransition } from "./animation.js";
import { containsAllWords, renderMatches } from "./search-simple.js";
import { matchScore } from "./search.js";
import { ellipsize, isOlderVersion } from "./text.js";

const PLUGIN_LIST_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
const PLUGIN_STATS_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugin-stats.json";
const THEME_LIST_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json";
const THEME_STATS_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes-stats.json";
const MANIFEST_FILE = "manifest.json";
const SLIDE_MS = 180;
const SLIDE_EASE = "cubic-bezier(0.33, 1, 0.68, 1)";
const noop = () => {};

function deferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** FIFO queue with an offset so dequeue stays O(1) amortised. */
class ItemQueue {
  constructor() { this.queue = []; this.offset = 0; }
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
    const next = offset + 1;
    if (next * 2 >= queue.length) { this.queue = queue.slice(next); this.offset = 0; }
    else this.offset = next;
    return item;
  }
  peek() { return this.queue.length > 0 ? this.queue[this.offset] : undefined; }
}

/** Start/stop/cancel flags around a unit of background work. */
class Runnable {
  constructor(options) {
    const { onStart = null, onStop = null, onCancel = null } = options || {};
    this.running = false;
    this.cancelled = false;
    this.onStart = onStart;
    this.onStop = onStop;
    this.onCancel = onCancel;
  }
  start() { if (!this.running) { this.running = true; if (this.onStart) this.onStart(); } }
  stop() { if (this.running) { this.running = false; if (this.onStop) this.onStop(); } }
  cancel() { this.stop(); if (!this.cancelled) { this.cancelled = true; if (this.onCancel) this.onCancel(); } }
  isRunning() { return this.running; }
  isCancelled() { return this.cancelled; }
}

/** Queue of render callbacks consumed by an async generator; producers call notify() to wake it. */
class RenderQueue {
  constructor(run) {
    this.items = new ItemQueue();
    this.promise = null;
    this.runnable = new Runnable(run);
  }
  addList(list) { this.items.enqueueArray(list); this.notify(); }
  add(item) { this.items.enqueue(item); this.notify(); }
  remove(item) { this.items.remove(item); }
  clear() { this.items.clear(); }
  notify() {
    const pending = this.promise;
    if (pending) {
      this.promise = null;
      setTimeout(() => { if (pending) pending.resolve(); }, 0);
    }
  }
  cancel() { this.runnable.cancel(); }
  async *generator() {
    const runnable = this.runnable;
    for (;;) {
      if (runnable.isCancelled()) return;
      if (this.items.length !== 0) {
        runnable.start();
        yield await this.items.dequeue();
        continue;
      }
      runnable.stop();
      await (this.promise = deferred()).promise;
    }
  }
}

/** Yields each item of `source`, pausing `maxDelay` ms (via requestIdleCallback when possible) after
 *  every `batchSize` items once more than `duration` ms have passed since the last pause. */
async function* batchAsync(source, options) {
  const { batchSize = 10, duration = 5, maxDelay = 100, beforePause = null } = options || {};
  let count = 0;
  let lastPause = performance.now();
  const win = (typeof activeWindow !== "undefined" && activeWindow) || window;
  for await (const item of source) {
    yield await item;
    count++;
    if (count % batchSize === 0) {
      const now = performance.now();
      if (now - lastPause > duration) {
        if (beforePause) beforePause(now);
        await new Promise((resolve) => {
          if (maxDelay > 0 && win.requestIdleCallback) {
            let done = false;
            const finish = () => { if (!done) { done = true; win.clearTimeout(timer); resolve(); } };
            const timer = win.setTimeout(finish, maxDelay);
            win.requestIdleCallback(finish);
          } else {
            win.setTimeout(resolve, maxDelay);
          }
        });
        lastPause = performance.now();
      }
    }
  }
}

/** Adds `is-loading` to `el` while `fn` runs. */
async function withLoading(el, fn) {
  el.addClass("is-loading");
  try {
    return await fn();
  } finally {
    el.removeClass("is-loading");
  }
}

/** Same as withLoading but with `mod-loading` (used on buttons). */
export async function withButtonLoading(el, fn) {
  el.addClass("mod-loading");
  try {
    return await fn();
  } finally {
    el.removeClass("mod-loading");
  }
}

/** Request through the app HTTP layer; resolves to {status, headers, arrayBuffer, json, text}
 *  (the shared `cy` already throws an HttpError on status >= 400 unless `throw: false`). */
async function request(options) {
  if (typeof options === "string") options = { url: options };
  return hostEnv().cy(options);
}

/** request() for callers that only need the body text (throws on HTTP errors). */
async function requestText(options) {
  return (await request(options)).text;
}

/** Wraps `fn` so its result is cached for `ttl` ms; concurrent calls share one in-flight promise and
 *  failures are not cached (retried after `errTtl` ms at most — actually failures clear immediately). */
function cachedCall(fn, ttl, errTtl) {
  if (errTtl === undefined) errTtl = ttl;
  let result = null;
  let until = 0;
  let pending = null;
  return function call() {
    if (pending) return pending;
    if (result && until > Date.now()) return Promise.resolve(result);
    pending = (async () => {
      until = Date.now() + errTtl;
      try {
        result = await fn();
      } catch (e) {
        pending = null;
        return null;
      }
      until = Date.now() + ttl;
      pending = null;
      setTimeout(() => { if (until > Date.now()) result = null; }, ttl);
      return result;
    })();
    return pending;
  };
}

const communityPlugins = cachedCall(async () => {
  const list = await request(PLUGIN_LIST_URL).then((r) => r.json);
  if (!Array.isArray(list)) throw new Error("Failed to parse community plugins.");
  return list;
}, 3e5, 6e4);

const communityPluginStats = cachedCall(async () => {
  const stats = await request(PLUGIN_STATS_URL);
  return stats.json;
}, 3e5, 6e4);

const communityThemes = cachedCall(async () => {
  const list = await request(THEME_LIST_URL).then((r) => r.json);
  if (Array.isArray(list) === false || list === null) throw new Error("Failed to load themes");
  return list;
}, 3e5, 6e4);

// upstream ships an empty stats feed for themes; keep the same shape
const communityThemeStats = cachedCall(async () => ({}), 3e5, 6e4);

function rawFileUrl(repo, path, ref) {
  return "https://raw.githubusercontent.com/" + repo + "/" + (ref || "HEAD") + "/" + path;
}
function repoUrl(repo) { return "https://github.com/" + repo; }
const compareText = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true }).compare;

/** Latest version in versions.json compatible with the running app, or the manifest version. */
async function pickCompatibleVersion(repo, manifest) {
  const appVersion = hostEnv().gte;
  let version = manifest.version || null;
  const minAppVersion = manifest.minAppVersion;
  if (!appVersion || !minAppVersion || !isOlderVersion(appVersion, minAppVersion)) return version;
  try {
    version = null;
    const versions = await request(rawFileUrl(repo, "versions.json")).then((r) => r.json);
    if (versions) {
      for (const candidate in versions) {
        if (versions.hasOwnProperty(candidate)) {
          if (isOlderVersion(appVersion, versions[candidate]) || (version && !isOlderVersion(version, candidate))) continue;
          version = candidate;
        }
      }
      return version;
    }
  } catch (e) { /* fall through */ }
  return null;
}

/** Slides `el` into `container` in place of the current child, animating both (no-op when hidden). */
function slideContent(host, container, el, direction, done) {
  done = done || noop;
  for (const child of Array.prototype.slice.call(container.childNodes)) cancelTransition(child);
  const first = container.firstChild;
  if (!first) {
    container.appendChild(el);
    done();
    return;
  }
  if (first === el && !el.nextSibling) {
    done();
    return;
  }
  if (!container.isShown()) {
    container.setChildrenInPlace([el]);
    done();
    return;
  }
  if (direction === "left") {
    container.setChildrenInPlace([el, first]);
    runTransition(el, new host.Transition({ duration: SLIDE_MS, fn: "ease-out" }).addProp("transform", "translateX(-20%)", "translateX(0)", ""));
    runTransition(first, new host.Transition({ duration: SLIDE_MS, fn: SLIDE_EASE }).addProp("transform", "translateX(0)", "translateX(100%)", ""), () => {
      first.detach();
      done();
    });
  } else {
    container.setChildrenInPlace([first, el]);
    runTransition(first, new host.Transition({ duration: SLIDE_MS, fn: "ease-out" }).addProp("transform", "translateX(0)", "translateX(-20%)", ""));
    runTransition(el, new host.Transition({ duration: SLIDE_MS, fn: SLIDE_EASE }).addProp("transform", "translateX(100%)", "translateX(0)", ""), () => {
      first.detach();
      done();
    });
  }
}

function sortOrderLabel(key) {
  const t = hostEnv().t.setting.thirdPartyPlugin;
  return {
    download: t.labelByPopularity(),
    release: t.labelByReleased(),
    alphabetical: t.labelAlphabetical(),
    update: t.labelByUpdated(),
  }[key]();
}

/** Base class for the community browsers: search box, sort menu, installed-only toggle, result list
 *  with progressive rendering and a details pane. Subclasses provide loadItems/updateItems/showItem. */
export function defineCommunityModal(host) {
  const env = () => hostEnv();

  function CommunityModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.sortOrder = "download";
    self.items = {};
    self.itemsVisible = [];
    self.selectedItemId = null;
    self.selectedItemCloseable = null;
    self.dimBackground = false;
    self.returnToGridView = self.returnToGridView.bind(self);

    self.modalEl.addClass("mod-community-modal", "mod-sidebar-layout");
    const sidebarEl = (self.sidebarEl = self.contentEl.createDiv("modal-sidebar"));
    self.detailsEl = createDiv("community-modal-details");
    sidebarEl.createDiv("community-modal-controls", (controls) => {
      new host.Setting(controls)
        .addSearch((search) => {
          self.search = search
            .onChange(debounceCall(self.update.bind(self), 300))
            .then(() => {
              search.inputEl.addEventListener("keypress", (event) => {
                if (!event.isComposing && event.key === "Enter" && !host.Platform.hasPhysicalKeyboard) host.blurAndClearSelection();
              });
            });
        })
        .addButton((button) => {
          button
            .onClick((event) => self.showSortMenu(event))
            .then((b) => {
              const el = b.buttonEl;
              host.setIcon(el, "lucide-sort-asc");
              host.setTooltip(el, host.t.plugins.fileExplorer.actionChangeSort());
              el.addClass("clickable-icon");
            });
        });
      self.installedOnlyToggleSetting = new host.Setting(controls)
        .setName(host.t.setting.thirdPartyPlugin.showInstalledOnly())
        .addToggle((toggle) => {
          self.installedOnlyToggle = toggle.setValue(false).onChange(() => self.update());
        });
      self.addCustomControls(controls);
      self.searchSummaryEl = controls.createDiv("community-modal-search-summary u-muted");
    });

    const resultsWrapper = sidebarEl.createDiv("community-modal-search-results-wrapper");
    self.emptyStateEl = resultsWrapper.createDiv("community-modal-empty-state");
    self.listStatusEl = resultsWrapper.createDiv("community-modal-search-results-status");
    self.listEl = resultsWrapper.createDiv("community-modal-search-results");

    if (host.Platform.isMobile) {
      host.onSwipe(self.contentEl, (gesture) => {
        if (gesture.points === 1 && gesture.direction === "x" && !(self.selectedItemId === null || gesture.touch.clientX > 40)) {
          const detailsEl = self.detailsEl;
          const sidebar = self.sidebarEl;
          self.contentEl.prepend(sidebar);
          host.restoreScrollPositions(sidebar);
          gesture.registerCallback({
            move(touchX, _, fraction) {
              const width = detailsEl.offsetWidth;
              const offset = Math.clamp((touchX - gesture.startX) / width, 0, 1);
              detailsEl.style.transform = `translateX(${offset * width}px)`;
            },
            cancel() {
              detailsEl.style.transform = "";
              sidebar.detach();
            },
            finish(touchX, _, velocity) {
              const width = detailsEl.offsetWidth;
              const offset = Math.clamp((touchX - gesture.startX) / width, 0, 1);
              if (0.5 * velocity < width / 2) {
                runTransition(detailsEl, new host.Transition({ duration: 200 * offset }).addProp("transform", null, "translateX(0)", ""), () => sidebar.detach());
              } else {
                runTransition(detailsEl, new host.Transition({ duration: 100 * (1 - offset), fn: "ease-out" }).addProp("transform", null, `translateX(${width}px)`, ""), () => {
                  detailsEl.detach();
                  self.returnToGridView();
                });
              }
            },
          });
        }
      });
    }

    self.renderQueue = new RenderQueue();
    let waitNearBottom = null;
    const resultsEl = resultsWrapper;
    const onScroll = () => {
      if (resultsEl.scrollTop + resultsEl.clientHeight < resultsEl.scrollHeight - resultsEl.clientHeight / 2) {
        if (!waitNearBottom) waitNearBottom = deferred();
      } else if (waitNearBottom) {
        waitNearBottom.resolve();
        waitNearBottom = null;
      }
    };
    const consumer = batchAsync(self.renderQueue.generator(), { batchSize: 10, beforePause: onScroll });
    (async () => {
      try {
        for await (const render of consumer) {
          await render();
          if (waitNearBottom) await waitNearBottom.promise;
        }
      } catch (e) {
        // consumer errors are non-fatal (queue cancelled on close)
      }
    })();
    resultsEl.addEventListener("scroll", onScroll, { passive: true });
    return self;
  }
  inherit(CommunityModal, host.Modal);
  const proto = CommunityModal.prototype;

  proto.onOpen = async function () {
    this.listEl.hide();
    this.emptyStateEl.show();
    try {
      this.items = await withLoading(this.emptyStateEl, () => this.loadItems());
      this.listEl.show();
      this.emptyStateEl.hide();
      this.emptyStateEl.empty();
      this.update();
      if (this.selectedItemId) this.selectItem(this.selectedItemId);
    } catch (e) {
      this.listEl.hide();
      const buttons = createDiv("button-container");
      const retry = buttons.createEl("button", { cls: "mod-cta", text: host.t.dialogue.buttonRetry() });
      retry.addEventListener("click", () => withButtonLoading(retry, () => this.onOpen()));
      this.emptyStateEl.setChildrenInPlace([createDiv({ text: e.message }), buttons]);
      this.emptyStateEl.show();
    }
  };

  proto.onClose = function () {
    host.unregisterOpenModal(this.selectedItemCloseable);
    if (this.onCloseCallback) this.onCloseCallback();
  };

  proto.onEscapeKey = function () {
    if (this.selectedItemId) this.returnToGridView();
    else this.close();
  };

  proto.update = function () {
    const visible = (this.itemsVisible = this.updateItems());
    const listEl = this.listEl;
    if (visible.length === 0) {
      listEl.setChildrenInPlace([createDiv({ cls: "community-item", text: host.t.setting.thirdPartyPlugin.labelNoResultsFound() })]);
    } else {
      listEl.setChildrenInPlace(visible.map((item) => item.el));
    }
  };

  proto.returnToGridView = function () {
    const selectNone = () => this.selectItem(null);
    if (host.Platform.isPhone && this.detailsEl.isShown()) {
      slideContent(host, this.contentEl, this.sidebarEl, "left", selectNone);
      host.restoreScrollPositions(this.sidebarEl);
    } else {
      selectNone();
    }
  };

  proto.selectItem = function (id) {
    const detailsEl = this.detailsEl;
    if (detailsEl.hasClass("is-loading")) return;
    const items = this.items;
    const previousId = this.selectedItemId;
    if (Object.hasOwn(items, previousId)) items[previousId].el.removeClass("is-selected");
    detailsEl.empty();
    if (this.backButtonEl) this.backButtonEl.detach();
    this.backButtonEl = null;
    host.unregisterOpenModal(this.selectedItemCloseable);
    this.selectedItemCloseable = null;
    if (id === null || !detailsEl.parentElement) this.contentEl.append(detailsEl);
    if (id === null || !Object.hasOwn(items, id)) {
      this.selectedItemId = "";
      detailsEl.detach();
      return;
    }
    this.selectedItemId = id;
    this.selectedItemCloseable = { close: this.returnToGridView.bind(this) };
    host.registerOpenModal(this.selectedItemCloseable);
    const item = items[id];
    item.el.addClass("is-selected");
    withLoading(detailsEl, async () => {
      if (host.Platform.isPhone) {
        this.backButtonEl = this.titleEl.createDiv("clickable-icon modal-setting-back-button mod-raised", (el) => {
          el.addEventListener("click", this.returnToGridView);
          host.setIcon(el, "lucide-arrow-left");
        });
        host.saveScrollPositions(this.sidebarEl);
        slideContent(host, this.contentEl, detailsEl, "right");
      } else {
        detailsEl.createDiv("modal-setting-nav-bar", (bar) => {
          bar.createDiv("clickable-icon", (el) => {
            host.setTooltip(el, host.t.interface.startScreen.buttonBack());
            host.setIcon(el, "lucide-chevron-left");
            el.addEventListener("click", this.returnToGridView);
          });
        });
      }
      await this.showItem(item);
    });
  };

  proto.showSortMenu = function (event) {
    event.preventDefault();
    const target = event.currentTarget;
    if (target.hasClass("has-active-menu")) return;
    const menu = new host.Menu();
    const current = this.sortOrder;
    for (const key of this.sortOrderOptions) {
      const label = sortOrderLabel(key);
      menu.addItem((item) => {
        item.setTitle(label).setChecked(key === current).onClick(() => {
          this.sortOrder = key;
          this.update();
        });
      });
    }
    menu.setParentElement(target).showAtMouseEvent(event);
  };

  proto.sortItems = function (items) {
    const order = this.sortOrder;
    if (order === "release") {
      items.reverse();
      return;
    }
    const comparator = order === "update"
      ? (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
      : order === "alphabetical"
        ? (a, b) => compareText(a.name, b.name)
        : (a, b) => b.downloads - a.downloads;
    items.sort(comparator);
  };

  proto.scrollIntoView = function (id) {
    const item = this.items[id];
    if (item && !host.Platform.isPhone) item.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  proto.addCustomControls = function () {};

  return CommunityModal;
}

/** Community plugin browser (inherited M0). */
export function definePluginBrowserModal(host) {
  const env = () => hostEnv();
  const CommunityModal = defineCommunityModal(host);
  const i18n = () => host.t.setting.thirdPartyPlugin;

  function PluginBrowserModal(app) {
    const self = CommunityModal.call(this, app) || this;
    self.sortOrderOptions = ["download", "update", "release", "alphabetical"];
    self.setTitle(i18n().name());
    self.modalEl.addClass("mod-community-plugin");
    self.search.setPlaceholder(i18n().placeholderCommunityPlugins());
    self.sortOrder = localStorage.getItem("communityPluginSortOrder") || "download";
    return self;
  }
  inherit(PluginBrowserModal, CommunityModal);
  const proto = PluginBrowserModal.prototype;

  proto.onClose = function () {
    CommunityModal.prototype.onClose.call(this);
    localStorage.setItem("communityPluginSortOrder", this.sortOrder);
  };

  proto.setAutoOpen = function (id) {
    this.selectedItemId = id;
    return this;
  };

  proto.loadItems = async function () {
    let list = null;
    try {
      list = await communityPlugins();
    } catch (e) {
      console.error(e);
    }
    if (!list) throw new Error(i18n().msgFailedLoadPlugins());
    const stats = {};
    try {
      Object.assign(stats, await communityPluginStats());
    } catch (e) {
      console.error(e);
    }
    const items = {};
    const add = (entry) => {
      const id = entry.id;
      let downloads = 0;
      let updated = 0;
      if (stats.hasOwnProperty(id)) {
        const stat = stats[id];
        downloads = stat.downloads ?? 0;
        updated = stat.updated ?? 0;
      }
      const el = createDiv("community-item tappable");
      el.addEventListener("click", () => this.selectItem(id));
      items[id] = { ...entry, downloads, updated, el, nameEl: null, authorEl: null, descEl: null, init: false };
    };
    for (const entry of list) add(entry);
    const autoOpen = this.selectedItemId;
    if (autoOpen && !items.hasOwnProperty(autoOpen)) this.search.setValue(autoOpen.split("-").join(" "));
    return items;
  };

  proto.updateItems = function () {
    const items = this.items;
    const query = this.search.getValue().trim().toLowerCase();
    const installedOnly = this.installedOnlyToggle.getValue();
    const manifests = this.app.plugins.manifests;
    const words = query.split(" ");
    const visible = [];
    for (const id in items) {
      if (!items.hasOwnProperty(id)) continue;
      const item = items[id];
      if (!item.id || !item.name || !item.repo) continue;
      item.matches = null;
      item.score = 0;
      if (installedOnly && !manifests.hasOwnProperty(item.id)) continue;
      if (query === "") {
        visible.push(item);
        continue;
      }
      const name = item.name;
      const author = item.author || "";
      const description = item.description || "";
      const haystack = name.toLowerCase() + author.toLowerCase() + description.toLowerCase();
      item.matches = containsAllWords(words, haystack);
      if (item.matches) {
        visible.push(item);
        item.score = matchScore(item.matches, haystack.length, query.length, 0);
      }
    }
    this.sortItems(visible);
    this.renderQueue.clear();
    let index = 0;
    for (const item of visible) {
      const render = () => {
        const el = item.el;
        let nameEl = item.nameEl;
        let authorEl = item.authorEl;
        let descEl = item.descEl;
        const id = item.id;
        const name = item.name;
        let author = item.author || "";
        let description = item.description || "";
        const matches = item.matches;
        if (!item.init) {
          const downloads = item.downloads;
          const updated = item.updated;
          nameEl = item.nameEl = el.createDiv("community-item-name");
          authorEl = item.authorEl = el.createDiv("community-item-author");
          if (downloads) {
            const downloadsEl = el.createDiv("community-item-downloads");
            downloadsEl.createSpan({}, (span) => host.setIcon(span, "lucide-download-cloud"));
            downloadsEl.createSpan({ cls: "community-item-downloads-text", text: downloads.toLocaleString() });
          }
          if (updated !== 0) {
            el.createDiv({ cls: "community-item-updated", text: i18n().labelLastUpdated({ time: window.moment(updated).fromNow() }) });
          }
          descEl = item.descEl = el.createDiv({ cls: "community-item-desc" });
          item.init = true;
        }
        nameEl.empty();
        authorEl.empty();
        descEl.empty();
        renderMatches(nameEl, name, matches);
        if (manifests.hasOwnProperty(id)) nameEl.createSpan({ cls: "flair mod-pop", text: i18n().labelInstalled() });
        if (author) {
          authorEl.setText(i18n().labelByAuthor());
          renderMatches(authorEl, author, matches, -name.length);
        }
        if (description) renderMatches(descEl, ellipsize(description, 200), matches, -(name.length + author.length));
        el.show();
      };
      item.el.hide();
      if (index < 20) render();
      else this.renderQueue.add(render);
      index++;
    }
    const count = host.t.nouns.pluginWithCount({ count: visible.length });
    this.searchSummaryEl.setText(i18n().labelSearchSummary({ pluginCount: count }));
    return visible;
  };

  proto.showItem = async function (item) {
    const app = this.app;
    const detailsEl = this.detailsEl;
    const id = item.id;
    const name = item.name;
    const description = item.description;
    const repo = item.repo;
    let version = null;
    try {
      const manifest = await request(rawFileUrl(repo, MANIFEST_FILE)).then((r) => r.json);
      if (manifest.id && manifest.id === id) {
        version = manifest;
      } else {
        new host.Notice("Plugin ID mismatch.");
        return;
      }
    } catch (e) {
      console.error(e);
      new host.Notice(i18n().msgFailedToLoadManifest());
      return;
    }
    const latest = (await pickCompatibleVersion(repo, version)) || version.version;
    const meta = detailsEl.createDiv("community-modal-info");
    const metaInner = meta.createDiv("community-modal-meta");
    const nameEl = metaInner.createDiv({ cls: "community-modal-info-name", text: name });
    const installed = app.plugins.manifests[id];
    if (installed) nameEl.createSpan({ cls: "flair mod-pop", text: i18n().labelInstalled() });
    if (item.downloads) {
      metaInner.createDiv("community-modal-info-downloads", (el) => {
        el.createSpan({}, (span) => host.setIcon(span, "lucide-download-cloud"));
        el.createSpan({ cls: "community-modal-info-downloads-text", text: item.downloads.toLocaleString() });
      });
    }
    if (latest) {
      const versionEl = metaInner.createDiv({ cls: "community-modal-info-version", text: i18n().labelVersion({ version: latest }) });
      if (installed && installed.version) versionEl.appendText(i18n().labelCurrentlyInstalledVersion({ version: installed.version }));
    }
    const author = item.author || version.author;
    if (author) {
      const authorEl = metaInner.createDiv({ cls: "community-modal-info-author", text: i18n().labelByAuthor() });
      if (version.authorUrl) {
        authorEl.createEl("a", { href: version.authorUrl, text: author, attr: { target: "_blank", rel: "noopener" } });
      } else {
        authorEl.appendText(author);
      }
    }
    const repoEl = metaInner.createDiv({ cls: "community-modal-info-repo", text: i18n().labelRepository() });
    const repoLink = repoUrl(repo);
    repoEl.createEl("a", { href: repoLink, text: repoLink, attr: { target: "_blank", rel: "noopener" } });
    if (item.updated !== 0) {
      metaInner.createDiv({ cls: "community-modal-info-repo", text: i18n().labelLastUpdate() }, (el) => {
        el.createEl("a", {
          href: repoLink + "/releases/latest",
          text: window.moment(item.updated).fromNow(),
          attr: { target: "_blank", rel: "noopener" },
        }, (a) => host.setTooltip(a, i18n().tooltipViewLastUpdate()));
      });
    }
    if (description) metaInner.createDiv({ cls: "community-modal-info-desc", text: description });
    const desktopOnly = !host.Platform.isDesktopApp && version.isDesktopOnly;
    if (desktopOnly) metaInner.createDiv({ cls: "mod-warning", text: i18n().labelUnsupported() });
    const buttons = metaInner.createDiv("community-modal-button-container");
    const installButton = buttons.createEl("button", { cls: "mod-cta", text: i18n().buttonInstall() });
    installButton.addEventListener("click", async () => {
      if (desktopOnly) {
        new host.Notice(i18n().labelUnsupported());
        return;
      }
      const compatible = await pickCompatibleVersion(repo, version);
      if (!compatible) {
        new host.Notice("No appropriate version found.");
        return;
      }
      await withButtonLoading(installButton, () => app.plugins.installPlugin(repo, compatible, version));
      this.update();
      await this.selectItem(item.id);
    });
    const plugin = app.plugins.getPlugin(id);
    if (installed) {
      if (isOlderVersion(installed.version, latest)) installButton.setText(i18n().buttonUpdate());
      else installButton.detach();
    }
    if (plugin) {
      const setting = this.app.setting;
      if (setting.pluginTabs.some((tab) => tab.id === id)) {
        buttons.createEl("button", { text: host.t.setting.options() }).addEventListener("click", () => {
          this.close();
          setting.open();
          setting.openTabById(version.id);
        });
      }
      if (Object.keys(app.commands.commands).some((cmd) => cmd.startsWith(id + ":"))) {
        buttons.createEl("button", { text: host.t.setting.hotkeys.name() }).addEventListener("click", () => {
          this.close();
          setting.open();
          const tab = setting.openTabById("hotkeys");
          if (tab instanceof env().C0) tab.setQuery(version.id);
        });
      }
      buttons.createEl("button", {
        cls: plugin ? "mod-destructive" : "mod-cta",
        text: i18n()(plugin ? "button-disable" : "button-enable"),
      }).addEventListener("click", async () => {
        if (plugin) await app.plugins.disablePluginAndSave(id);
        else await app.plugins.enablePluginAndSave(id);
        await this.selectItem(item.id);
      });
      buttons.createEl("button", { cls: "mod-destructive", text: i18n().labelUninstall() }).addEventListener("click", async () => {
        await app.plugins.uninstallPlugin(id);
        this.update();
        await this.selectItem(item.id);
      });
    }
    buttons.createEl("button", { text: i18n().buttonCopyShareLink() }).addEventListener("click", async () => {
      await navigator.clipboard.writeText("basalt://show-plugin?id=" + encodeURIComponent(id));
      new host.Notice(host.t.interface.copied());
    });
    if (version.fundingUrl) {
      buttons.createEl("button", { text: i18n().buttonDonate() }).addEventListener("click", () => {
        new (env().S0)(app, item.name, version.fundingUrl).open();
      });
    }
    let readme = "";
    try {
      readme = await requestText(rawFileUrl(repo, "README.md"));
    } catch (e) {
      readme = i18n().labelNoReadme();
    }
    const readmeEl = meta.createDiv("community-modal-readme markdown-rendered");
    readmeEl.appendChild(env().xL(env().Zx(env().Kx(readme))));
    env().eb(readmeEl, repo);
    this.scrollIntoView(id);
  };

  return PluginBrowserModal;
}

/** Community theme browser (inherited D0). */
export function defineThemeBrowserModal(host) {
  const env = () => hostEnv();
  const CommunityModal = defineCommunityModal(host);
  const themeI18n = () => host.t.plugins.customCss;
  const pluginI18n = () => host.t.setting.thirdPartyPlugin;

  function ThemeBrowserModal(app, onlyShowUpdates) {
    const self = CommunityModal.call(this, app) || this;
    self.sortOrderOptions = ["download", "release", "alphabetical"];
    self.setTitle(themeI18n().settingCommunityThemes());
    self.modalEl.addClass("mod-community-theme");
    self.search.setPlaceholder(themeI18n().promptFilter());
    self.sortOrder = localStorage.getItem("communityThemeSortOrder") || "download";
    self.onlyShowUpdates = onlyShowUpdates;
    self.imageResizeQueue = new RenderQueue();
    const resizer = batchAsync(self.imageResizeQueue.generator(), { batchSize: 1, maxDelay: 100 });
    (async () => {
      try {
        for await (const image of resizer) {
          if (!image.isShown()) continue;
          if (image.naturalWidth > 640 || image.naturalHeight > 320) {
            try {
              const canvas = activeDocument.createElement("canvas");
              const ctx = canvas.getContext("2d");
              ctx.imageSmoothingQuality = "high";
              const scale = Math.min(512 / image.naturalWidth, 288 / image.naturalHeight);
              canvas.width = Math.floor(image.naturalWidth * scale);
              canvas.height = Math.floor(image.naturalHeight * scale);
              ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
              image.src = canvas.toDataURL();
            } catch (e) {
              console.log("Unable to downsize theme image", e);
            }
          }
        }
      } catch (e) { /* queue cancelled */ }
    })();
    return self;
  }
  inherit(ThemeBrowserModal, CommunityModal);
  const proto = ThemeBrowserModal.prototype;

  proto.onClose = function () {
    CommunityModal.prototype.onClose.call(this);
    localStorage.setItem("communityThemeSortOrder", this.sortOrder);
  };

  proto.onOpen = async function () {
    if (this.onlyShowUpdates) {
      this.currentModeToggleSetting.settingEl.detach();
      this.installedOnlyToggleSetting.settingEl.detach();
    } else if (this.app.vault.getConfig("theme") === "system") {
      this.currentModeToggleSetting.settingEl.detach();
      this.currentModeToggle.setValue(false);
    }
    await CommunityModal.prototype.onOpen.call(this);
  };

  proto.addCustomControls = function (controls) {
    const self = this;
    this.currentModeToggleSetting = new host.Setting(controls)
      .setName(this.app.vault.getConfig("theme") === "basalt" ? themeI18n().labelDarkThemeOnly() : themeI18n().labelLightThemeOnly())
      .addToggle((toggle) => {
        this.currentModeToggle = toggle.setValue(true).onChange(() => this.update());
      });
  };

  proto.setAutoOpen = function (id) {
    this.selectedItemId = id;
    return this;
  };

  proto.loadItems = async function () {
    const customCss = this.app.customCss;
    let loaded = false;
    const feed = {};
    const stats = {};
    let raw = [];
    try {
      raw = (await communityThemes()) || [];
      for (const entry of raw) {
        if (entry.author && String.isString(entry.author) && entry.name && String.isString(entry.name) &&
            entry.repo && String.isString(entry.repo) && entry.modes && Array.isArray(entry.modes)) {
          feed[entry.name] = entry;
        }
      }
      loaded = true;
    } catch (e) {
      console.error(e);
    }
    try {
      Object.assign(stats, await communityThemeStats());
    } catch (e) {
      console.error(e);
    }
    const downloadsOf = (name) => (stats && Object.hasOwn(stats, name) ? stats[name].download : 0);
    this.listStatusEl.empty();
    this.listStatusEl.toggle(!loaded);
    if (!loaded) {
      this.listStatusEl.createDiv("community-modal-search-results-status-content", (el) => {
        el.createDiv({ text: themeI18n().msgLoadError() });
        el.createDiv({ cls: "community-modal-search-results-cta", text: host.t.dialogue.buttonRetry() }).addEventListener("click", async () => {
          await withLoading(this.emptyStateEl, () => this.loadItems());
          this.items = await this.loadItems();
          this.update();
        });
      });
    }
    const items = {};
    items[""] = this.addThemeCard({
      name: "", author: "Basalt", modes: ["dark", "light"],
      screenshot: customCss.isDarkMode() ? "dark.png" : "light.png",
      repo: "obsidianmd/obsidian-releases", downloads: 0,
    });
    for (const name in customCss.themes) {
      if (customCss.themes.hasOwnProperty(name)) {
        const theme = customCss.themes[name];
        const meta = feed[name] || {};
        items[name] = this.addThemeCard({ name, author: "", modes: ["dark", "light"], screenshot: "", repo: "", ...meta, ...theme, downloads: downloadsOf(name) });
      }
    }
    for (const name of customCss.oldThemes) {
      if (!customCss.themes.hasOwnProperty(name)) {
        const meta = feed[name] || {};
        items[name] = this.addThemeCard({ name, author: "", modes: ["dark", "light"], screenshot: "", repo: "", ...meta, downloads: downloadsOf(name) });
      }
    }
    for (const name in feed) {
      if (items.hasOwnProperty(name)) continue;
      const entry = feed[name];
      if (entry.legacy) continue;
      items[name] = this.addThemeCard({
        name: entry.name, author: entry.author, repo: entry.repo,
        modes: entry.modes, screenshot: entry.screenshot, downloads: downloadsOf(name),
      });
    }
    return items;
  };

  proto.addThemeCard = function (data) {
    const self = this;
    const name = data.name;
    const author = data.author;
    const repo = data.repo;
    const modes = data.modes;
    const screenshot = data.screenshot;
    const downloads = data.downloads;
    const el = createDiv("community-item tappable");
    el.addEventListener("click", () => this.selectItem(name));
    return { name, author, repo, modes, screenshot, downloads, el, nameEl: null, authorEl: null, updateIconEl: null, updated: 0, init: false };
  };

  proto.updateItems = function () {
    const self = this;
    const items = this.items;
    const customCss = this.app.customCss;
    const query = this.search.getValue().trim().toLowerCase();
    const installedOnly = this.installedOnlyToggle.getValue();
    const onlyUpdates = this.onlyShowUpdates;
    const modeFilter = !onlyUpdates && this.currentModeToggle.getValue();
    const installed = new Set(customCss.oldThemes.concat(Object.keys(customCss.themes)).concat(""));
    const mode = customCss.isDarkMode() ? "dark" : "light";
    const words = query.split(" ");
    const visible = [];
    let defaultItem = null;
    for (const key in items) {
      if (!Object.hasOwn(items, key)) continue;
      const item = items[key];
      if (item.name === "") defaultItem = item;
      if (installedOnly && !installed.has(item.name)) continue;
      if (modeFilter && !item.modes.contains(mode)) continue;
      if (onlyUpdates && !Object.hasOwn(customCss.updates, item.name)) continue;
      item.matches = null;
      item.score = 0;
      if (query === "") {
        visible.push(item);
        continue;
      }
      const name = item.name;
      let author = item.author || "";
      if (!name) continue;
      const haystack = name.toLowerCase() + author.toLowerCase();
      item.matches = containsAllWords(words, haystack);
      if (item.matches) {
        visible.push(item);
        item.score = matchScore(item.matches, haystack.length, query.length, 0);
      }
    }
    this.sortItems(visible);
    if (defaultItem && visible.contains(defaultItem)) {
      visible.remove(defaultItem);
      visible.unshift(defaultItem);
    }
    this.renderQueue.clear();
    let index = 0;
    for (const item of visible) {
      const render = () => {
        const el = item.el;
        let nameEl = item.nameEl;
        let authorEl = item.authorEl;
        let updateIconEl = item.updateIconEl;
        const name = item.name;
        const author = item.author;
        const matches = item.matches;
        const isDefault = name === "";
        if (!item.init) {
          const downloads = item.downloads;
          const repo = item.repo;
          const screenshot = item.screenshot;
          nameEl = item.nameEl = el.createDiv("community-item-name");
          authorEl = item.authorEl = el.createDiv("community-item-author");
          updateIconEl = item.updateIconEl = el.createDiv("community-item-badge mod-update");
          if (!isDefault && downloads) {
            const downloadsEl = el.createDiv("community-item-downloads");
            downloadsEl.createSpan({}, (span) => host.setIcon(span, "lucide-download-cloud"));
            downloadsEl.createSpan({ cls: "community-item-downloads-text", text: downloads.toLocaleString() });
          }
          if (repo && screenshot) {
            const img = el.createEl("img", { cls: "community-item-screenshot", attr: { alt: name, loading: "lazy" } });
            img.crossOrigin = "anonymous";
            img.style.opacity = "0";
            img.src = rawFileUrl(repo, screenshot);
            img.addEventListener("load", () => {
              img.style.opacity = "";
              if (img.naturalWidth > 640 || img.naturalHeight > 320) self.imageResizeQueue.add(img);
            });
          } else {
            el.createDiv("community-item-screenshot mod-unavailable", (placeholder) => {
              host.setIcon(placeholder.createDiv("placeholder-icon"), "lucide-camera-off");
            });
          }
          item.init = true;
        }
        const isInstalled = installed.has(name);
        const isActive = customCss.theme === name && (isInstalled || isDefault);
        el.toggleClass("mod-active", isActive);
        nameEl.empty();
        const displayName = isDefault ? host.t.setting.appearance.labelDefaultTheme() : name;
        renderMatches(nameEl, displayName, matches);
        if (isActive) {
          nameEl.createSpan({ cls: "flair mod-pop", text: host.t.setting.appearance.labelCurrentlyActive() });
        } else if (customCss.oldThemes.contains(name) && !customCss.themes.hasOwnProperty(name)) {
          nameEl.createSpan({ cls: "flair", text: themeI18n().labelLegacy() });
        } else if (isInstalled || isDefault) {
          nameEl.createSpan({ cls: "flair", text: pluginI18n().labelInstalled() });
        }
        authorEl.empty();
        if (author) {
          authorEl.setText(pluginI18n().labelByAuthor());
          renderMatches(authorEl, author, matches, -displayName.length);
        }
        if (customCss.updates.hasOwnProperty(item.name)) {
          if (!updateIconEl.firstChild) {
            host.setIcon(updateIconEl, "lucide-alert-triangle");
            host.setTooltip(updateIconEl, themeI18n().labelUpdateAvailable());
          }
          updateIconEl.show();
        } else {
          updateIconEl.hide();
        }
        el.show();
      };
      item.el.hide();
      if (index < 20) render();
      else this.renderQueue.add(render);
      index++;
    }
    const count = host.t.nouns.themeWithCount({ count: visible.length });
    this.searchSummaryEl.setText(themeI18n().labelSearchSummary({ themeCount: count }));
    return visible;
  };

  proto.showItem = async function (item) {
    const app = this.app;
    const customCss = app.customCss;
    const detailsEl = this.detailsEl;
    const name = item.name;
    const repo = item.repo;
    const isDefault = name === "";
    const isInstalled = customCss.isThemeInstalled(name);
    const isActive = customCss.theme === name && (isDefault || isInstalled);
    const isLegacy = customCss.oldThemes.contains(name) && !customCss.themes.hasOwnProperty(name);
    const displayName = isDefault ? host.t.setting.appearance.labelDefaultTheme() : name;
    let installedVersion = "";
    if (customCss.themes.hasOwnProperty(item.name)) installedVersion = customCss.themes[item.name].version || "";
    const manifest = await customCss.getManifest(repo);
    let latest = "";
    if (manifest) latest = (await pickCompatibleVersion(repo, manifest)) || manifest.version;

    const info = detailsEl.createDiv("community-modal-info");
    const meta = info.createDiv("community-modal-meta");
    const nameEl = meta.createDiv({ cls: "community-modal-info-name", text: displayName });
    if (isInstalled) nameEl.createSpan({ cls: "flair mod-pop", text: isLegacy ? themeI18n().labelLegacy() : pluginI18n().labelInstalled() });
    if (item.downloads) {
      meta.createDiv("community-modal-info-downloads", (el) => {
        el.createSpan({}, (span) => host.setIcon(span, "lucide-download-cloud"));
        el.createSpan({ cls: "community-modal-info-downloads-text", text: item.downloads.toLocaleString() });
      });
    }
    if (latest) {
      const versionEl = meta.createDiv({ cls: "community-modal-info-version", text: pluginI18n().labelVersion({ version: latest }) });
      if (isInstalled && installedVersion) versionEl.appendText(pluginI18n().labelCurrentlyInstalledVersion({ version: installedVersion }));
    }
    const author = item.author || (manifest && manifest.author);
    if (author) {
      const authorEl = meta.createDiv({ cls: "community-modal-info-author", text: pluginI18n().labelByAuthor() });
      if (manifest && manifest.authorUrl) {
        authorEl.createEl("a", { href: manifest.authorUrl, text: author, attr: { target: "_blank", rel: "noopener" } });
      } else {
        authorEl.appendText(author);
      }
    }
    if (repo && !isDefault) {
      const repoEl = meta.createDiv({ cls: "community-modal-info-repo", text: pluginI18n().labelRepository() });
      const link = repoUrl(repo);
      repoEl.createEl("a", { href: link, text: link, attr: { target: "_blank", rel: "noopener" } });
    }
    const buttons = meta.createDiv("community-modal-button-container");
    const install = async (button) => {
      let version = null;
      if (manifest) version = await pickCompatibleVersion(repo, manifest);
      if (!version) {
        new host.Notice("No appropriate version found.");
        return;
      }
      await withLoading(button, () => customCss.installTheme(item, version));
      this.update();
      await this.selectItem(displayName);
    };
    if (isActive) {
      if (isDefault) {
        buttons.createEl("button", { text: host.t.setting.appearance.labelCurrentlyActive(), attr: { disabled: true } });
      } else {
        buttons.createEl("button", { text: themeI18n().labelStopUse() }).addEventListener("click", async () => {
          customCss.setTheme("");
          this.update();
          await this.selectItem(displayName);
        });
      }
    } else {
      const useButton = buttons.createEl("button", {
        cls: "mod-cta",
        text: isDefault || isInstalled ? themeI18n().labelUse() : themeI18n().labelInstallAndUse(),
      });
      useButton.addEventListener("click", async () => {
        if (!isDefault && !isInstalled) await install(useButton);
        customCss.setTheme(item.name);
        this.update();
        await this.selectItem(displayName);
      });
      if (!isDefault && isInstalled) {
        if (customCss.updates.hasOwnProperty(item.name) || isOlderVersion(installedVersion, latest)) {
          const updateButton = buttons.createEl("button", { cls: "mod-cta", text: themeI18n().labelUpdate() });
          updateButton.addEventListener("click", async () => {
            await install(updateButton);
            this.update();
            await this.selectItem(displayName);
          });
        } else if (!manifest) {
          buttons.createEl("button", { text: host.t.setting.appearance.buttonCheckForUpdates() }).addEventListener("click", async () => {
            if (await customCss.checkForUpdate(item)) await this.selectItem(displayName);
            else new host.Notice(themeI18n().msgNoUpdatesFound());
          });
        }
      }
    }
    if (customCss.isThemeInstalled(displayName)) {
      buttons.createEl("button", { text: pluginI18n().labelUninstall() }).addEventListener("click", async () => {
        await customCss.removeTheme(displayName);
        this.update();
        await this.selectItem(displayName);
        new host.Notice(themeI18n().msgDeletedTheme({ title: displayName }));
      });
    }
    let readme;
    if (isDefault) {
      readme = "\nA simple theme designed to feel intuitive across all platforms. Supports light and dark mode.\n";
    } else {
      try {
        readme = await requestText(rawFileUrl(repo, "README.md"));
      } catch (e) {
        readme = themeI18n().labelNoReadme();
      }
    }
    const readmeEl = info.createDiv("community-modal-readme markdown-rendered");
    readmeEl.appendChild(env().xL(env().Zx(env().Kx(readme))));
    env().eb(readmeEl, repo);
    if (item.el && !host.Platform.isPhone) item.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return ThemeBrowserModal;
}

/** Donate dialog shown from a plugin's funding link (inherited S0). */
export function defineDonateModal(host) {
  const env = () => hostEnv();
  const i18n = () => host.t.setting.thirdPartyPlugin;

  function DonateModal(app, pluginName, fundingUrl) {
    const self = host.ButtonModal.call(this, app) || this;
    self.setTitle(i18n().labelDonateModalTitle({ name: pluginName }));
    const fragment = document.createDocumentFragment();
    fragment.createEl("p", { text: i18n().labelDonateModalText1() });
    fragment.createEl("p", { text: i18n().labelDonateModalText2() });
    fragment.createEl("p", { text: i18n().labelDonateModalText3() });
    fragment.createEl("hr");
    if (typeof fundingUrl === "string") {
      fragment.createEl("p", { text: i18n().labelSupportThisPlugin() + " " }, (el) => {
        el.createEl("a", { text: fundingUrl, href: fundingUrl, cls: "external-link", attr: { target: "_blank" } });
      });
    } else if (typeof fundingUrl === "object") {
      for (const platform in fundingUrl) {
        if (!fundingUrl.hasOwnProperty(platform)) continue;
        const url = fundingUrl[platform];
        fragment.createEl("p", { text: platform + ": " }, (el) => {
          el.createEl("a", { text: url, href: url, cls: "external-link", attr: { target: "_blank" } });
        });
      }
    }
    self.setContent(fragment);
    self.addButton("mod-cta", host.t.dialogue.buttonDone(), () => self.close());
    return self;
  }
  inherit(DonateModal, host.ButtonModal);
  return DonateModal;
}
