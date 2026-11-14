// The "Backlinks" and "Outgoing links" panes: a shared file-following view base (original gJ), the two view types
// (H6 "backlink", o7 "outgoing-link") and the pane bodies (z6 backlink component, a7 outgoing-link component with
// its virtualised link list s7 and link rows l7).
//
// Both bodies reuse the search results widget (search-view.js): one virtualised SearchResults per section, file
// results whose match rows are ordinary SearchMatchResult items. The outgoing "Links" section is a flat
// virtualised list of OutgoingLinkItem rows driven by its own InfinityScroll over an OutgoingLinkList root.

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { setElementTooltip } from "./tooltip.js";
import { makeTreePusher, markItemCollapsed } from "./tree.js";
import { frontmatterAliases } from "./frontmatter.js";
import { linkPath, parseLinktext, dropMdSuffix, parentPath, withoutExtension } from "./path.js";
import { resolveSubpath } from "./search-simple.js";
import { wholeWordPattern, searchClasses } from "./search-query.js";
import { searchViewClasses, batchedIteration, sortOrderComparator, SEARCH_SORT_ORDERS, SEARCH_SORT_GROUPS, searchSortLabel, compareSearchText, contextLineBounds, toggleElementVisibility } from "./search-view.js";

// Classes defined by the factories below, visible to each other regardless of factory order (views are only
// instantiated at runtime, long after every factory has run).
const linkPanes = {};

const VIEW_TYPE_BACKLINK = "backlink";
const VIEW_TYPE_OUTGOING = "outgoing-link";

// =====================================================================================================================
// Metadata-cache entry helpers (the little predicates the panes share)
// =====================================================================================================================

/** `anyRef`: true when some element of `list` makes `pred` return exactly true (the walkers short-circuit on === true,
 *  so a callback may return a truthy non-boolean to keep iterating). */
function anyRef(list, pred) {
  if (!list) return false;
  for (const item of list) {
    if (pred(item) === true) return true;
  }
  return false;
}

/** A cache ref that points at a source range (link/embed); property refs only carry `key`. */
function hasRefPosition(entry) {
  return entry.hasOwnProperty("position");
}

/** A cache ref that is a frontmatter property (`key`, optional dotted `subkey` parts, `original` text). */
function hasRefKey(entry) {
  return entry.hasOwnProperty("key");
}

/** Does the file cache hold a frontmatter/link/embed ref matching `pred`? (frontmatterLinks + links + embeds) */
function cacheHasMatchingRef(cache, pred) {
  return !!cache && (anyRef(cache.frontmatterLinks, pred) || anyRef(cache.links, pred) || anyRef(cache.embeds, pred));
}

/** Same, restricted to positioned refs (links and embeds, no frontmatter properties). */
function cacheHasLinkRange(cache, pred) {
  return !!cache && (anyRef(cache.links, pred) || anyRef(cache.embeds, pred));
}

/** The sort-order label lookup the ViewHeader dropdown expects (key -> title). */
const sortOrderLabelOf = (key) => searchSortLabel(key);

// =====================================================================================================================
// Shared view base: follows the active file unless pinned or inside a tab group
// =====================================================================================================================

/** Base for the link panes: tracks the active file, follows group siblings, keeps `update` cheap. */
export function defineLinkPaneView(host) {
  function LinkPaneView(leaf) {
    const self = host.FileView.call(this, leaf) || this;
    self.navigation = false;
    self.allowNoFile = true;
    self.requestUpdate = debounceCall(self.update.bind(self), 10);
    return self;
  }
  inherit(LinkPaneView, host.FileView);
  const proto = LinkPaneView.prototype;

  proto.load = function () {
    host.FileView.prototype.load.call(this);
    const workspace = this.app.workspace;
    this.registerEvent(workspace.on("file-open", this.onFileOpen, this));
    workspace.onLayoutReady(() => this.onFileOpen(workspace.getActiveFile()));
  };

  proto.setState = async function (state, result) {
    // An unpinned pane without an explicit group mirrors whatever file is active.
    if (!state.hasOwnProperty("group") && !this.leaf.pinned) {
      const active = this.leaf.workspace.getActiveFile();
      if (active) state.file = active && active.path;
    }
    return host.FileView.prototype.setState.call(this, state, result);
  };

  proto.onLoadFile = async function () {
    this.update();
  };

  proto.onUnloadFile = async function () {
    this.requestUpdate();
  };

  proto.onFileOpen = function (file) {
    if (this.leaf.group || this.leaf.pinned) return;
    this.loadFile(file && file instanceof host.TFile ? file : null);
  };

  proto.onGroupChange = function () {
    host.FileView.prototype.onGroupChange.call(this);
    if (this.leaf.group) {
      for (const leaf of this.leaf.workspace.getGroupLeaves(this.leaf.group)) {
        if (leaf !== this.leaf && leaf.view instanceof host.FileView) {
          this.leaf.openFile(leaf.view.file);
          break;
        }
      }
    } else {
      this.loadFile(this.leaf.workspace.getActiveFile());
    }
  };

  linkPanes.LinkPaneView = LinkPaneView;
  return LinkPaneView;
}

// =====================================================================================================================
// Backlinks pane body
// =====================================================================================================================

/** The backlinks component: "Linked mentions" (files whose links resolve here) and "Unlinked mentions" (plain-text
 *  occurrences of the file name / aliases outside of links and frontmatter). Both sections are SearchResults lists. */
export function defineBacklinkComponent(host) {
  const linksT = () => host.t.plugins.backlinks;
  const searchT = () => host.t.plugins.search;

  function BacklinkComponent(app, containerEl, scrollParent) {
    const self = host.Component.call(this) || this;
    self.collapseAll = false;
    self.extraContext = false;
    self.sortOrder = "alphabetical";
    self.isShowingSearch = false;
    self.searchQuery = null;
    self.backlinkFile = null;
    self.backlinkCollapsed = false;
    self.backlinkHeaderEl = null;
    self.backlinkCountEl = null;
    self.backlinkQueue = null;
    self.unlinkedFile = null;
    self.unlinkedCollapsed = false;
    self.unlinkedHeaderEl = null;
    self.unlinkedCountEl = null;
    self.unlinkedAliases = "";
    self.unlinkedQueue = null;
    self.app = app;

    const headerDom = (self.headerDom = new host.ViewHeader(app, containerEl));
    self.collapseAllButtonEl = headerDom.addNavButton("lucide-list", searchT().labelCollapseResults(), self.onToggleCollapseClick.bind(self));
    self.extraContextButtonEl = headerDom.addNavButton("lucide-move-vertical", searchT().labelMoreContext(), self.onToggleMoreContextClick.bind(self));
    headerDom.addSortButton(SEARCH_SORT_GROUPS, sortOrderLabelOf, (key) => self.setSortOrder(key), () => self.sortOrder);
    self.showSearchButtonEl = headerDom.addNavButton("lucide-search", linksT().labelShowSearch(), self.onToggleShowSearch.bind(self));
    self.searchComponent = new host.SearchComponent(headerDom.navHeaderEl)
      .setPlaceholder(searchT().promptStartSearch())
      .onChange(debounceCall(self.updateSearch.bind(self), 300, true))
      .then((component) => {
        setElementTooltip(component.clearButtonEl, searchT().tooltipClearSearch());
        component.inputEl.addEventListener("keypress", (event) => {
          if (event.isComposing) return;
          if (event.key !== "Enter") return;
          if (!host.Platform.hasPhysicalKeyboard) host.blurAndClearSelection();
          self.updateSearch();
        });
        component.containerEl.hide();
      });
    self.tooltipPlacement = undefined;

    const paneEl = containerEl.createDiv("backlink-pane");
    const scroll = scrollParent || paneEl;

    const backlinkHeaderEl = (self.backlinkHeaderEl = paneEl.createDiv("tree-item-self is-clickable"));
    backlinkHeaderEl.createSpan("tree-item-icon collapse-icon", (icon) => host.setIcon(icon, "right-triangle"));
    backlinkHeaderEl.createDiv({ cls: "tree-item-inner", text: linksT().labelLinkedMentions() });
    backlinkHeaderEl.addEventListener("click", self.toggleBacklinkCollapsed.bind(self));
    self.backlinkCountEl = backlinkHeaderEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
    self.backlinkDom = new searchViewClasses.SearchResults(app, paneEl.createDiv("search-result-container"), linksT().labelNoBacklinks(), scroll);

    const unlinkedHeaderEl = (self.unlinkedHeaderEl = paneEl.createDiv("tree-item-self is-clickable"));
    unlinkedHeaderEl.createSpan("tree-item-icon collapse-icon", (icon) => host.setIcon(icon, "right-triangle"));
    unlinkedHeaderEl.createDiv({ cls: "tree-item-inner", text: linksT().labelUnlinkedMentions() });
    unlinkedHeaderEl.addEventListener("click", self.toggleUnlinkedCollapsed.bind(self));
    self.unlinkedCountEl = unlinkedHeaderEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
    self.unlinkedDom = new searchViewClasses.SearchResults(app, paneEl.createDiv("search-result-container"), linksT().labelNoUnlinkedMentions(), scroll);

    self.setUnlinkedCollapsed(true, false);
    return self;
  }
  inherit(BacklinkComponent, host.Component);
  const proto = BacklinkComponent.prototype;

  proto.onload = function () {
    const { vault, metadataCache } = this.app;
    this.registerEvent(metadataCache.on("resolve", this.onMetadataChanged, this));
    this.registerEvent(vault.on("create", this.onFileChanged, this));
    this.registerEvent(vault.on("modify", this.onFileChanged, this));
    this.registerEvent(vault.on("rename", this.onFileRename, this));
    this.registerEvent(vault.on("delete", this.onFileDeleted, this));
  };

  proto.onToggleCollapseClick = function () {
    this.setCollapseAll(!this.collapseAll);
  };

  proto.setCollapseAll = function (collapseAll) {
    if (collapseAll === this.collapseAll) return;
    this.collapseAll = collapseAll;
    this.backlinkDom.setCollapseAll(collapseAll);
    this.unlinkedDom.setCollapseAll(collapseAll);
    this.collapseAllButtonEl.toggleClass("is-active", collapseAll);
    this.app.workspace.requestSaveLayout();
  };

  proto.onToggleMoreContextClick = function () {
    this.setExtraContext(!this.extraContext);
  };

  proto.setExtraContext = function (extraContext) {
    if (extraContext === this.extraContext) return;
    this.extraContext = extraContext;
    this.backlinkDom.setExtraContext(extraContext);
    this.unlinkedDom.setExtraContext(extraContext);
    this.extraContextButtonEl.toggleClass("is-active", extraContext);
    this.app.workspace.requestSaveLayout();
  };

  proto.getState = function () {
    return {
      collapseAll: this.collapseAll,
      extraContext: this.extraContext,
      sortOrder: this.sortOrder,
      showSearch: this.isShowingSearch,
      searchQuery: this.searchComponent.getValue(),
      backlinkCollapsed: this.backlinkCollapsed,
      unlinkedCollapsed: this.unlinkedCollapsed,
    };
  };

  proto.setState = async function (state) {
    const { collapseAll, extraContext, sortOrder, showSearch, searchQuery, backlinkCollapsed, unlinkedCollapsed } = state;
    if (isBoolean(collapseAll)) this.setCollapseAll(collapseAll);
    if (isBoolean(extraContext)) this.setExtraContext(extraContext);
    if (isBoolean(showSearch)) this.setShowSearch(showSearch);
    if (String.isString(sortOrder) && SEARCH_SORT_ORDERS.hasOwnProperty(sortOrder)) this.setSortOrder(sortOrder);
    if (isBoolean(backlinkCollapsed)) await this.setBacklinkCollapsed(backlinkCollapsed, false);
    if (isBoolean(unlinkedCollapsed)) await this.setUnlinkedCollapsed(unlinkedCollapsed, false);
    if (String.isString(searchQuery)) {
      this.searchComponent.setValue(searchQuery);
      this.updateSearch();
    }
  };

  proto.onToggleShowSearch = function () {
    this.setShowSearch(!this.isShowingSearch);
    if (this.isShowingSearch) this.searchComponent.inputEl.focus();
  };

  proto.setShowSearch = function (show) {
    if (show === this.isShowingSearch) return;
    this.isShowingSearch = show;
    this.searchComponent.containerEl.toggle(show);
    this.showSearchButtonEl.toggleClass("is-active", show);
    if (!show) {
      this.searchComponent.setValue("");
      this.updateSearch();
    }
    this.app.workspace.requestSaveLayout();
  };

  proto.setSortOrder = function (sortOrder) {
    if (sortOrder === this.sortOrder) return;
    this.sortOrder = sortOrder;
    this.backlinkDom.sortOrder = sortOrder;
    this.backlinkDom.changed();
    this.unlinkedDom.sortOrder = sortOrder;
    this.unlinkedDom.changed();
    this.app.workspace.requestSaveLayout();
  };

  proto.onResize = function () {
    this.backlinkDom.onResize();
    this.unlinkedDom.onResize();
  };

  /** Rebuilds the query object from the search box; an empty or invalid query clears the filter. */
  proto.updateSearch = function () {
    const query = this.searchComponent.getValue();
    const previous = this.searchQuery;
    if ((!previous && !query) || (previous && previous.query === query)) return;
    try {
      if (query) {
        const searchQuery = new searchClasses.SearchQuery(this.app, query, false);
        this.searchQuery = searchQuery.matcher ? searchQuery : null;
      } else {
        this.searchQuery = null;
      }
      this.backlinkFile = null;
      this.unlinkedFile = null;
      this.update();
    } catch (error) {
      new host.Notice(error.message);
      console.log(error);
    }
  };

  proto.toggleBacklinkCollapsed = function () {
    this.setBacklinkCollapsed(!this.backlinkCollapsed, true);
  };

  proto.setBacklinkCollapsed = async function (collapsed, animate) {
    if (collapsed === this.backlinkCollapsed) return;
    this.backlinkCollapsed = collapsed;
    await this.setSectionCollapsed(this.backlinkHeaderEl, this.backlinkDom, collapsed, animate);
    this.app.workspace.requestSaveLayout();
    this.backlinkDom.infinityScroll.updateVirtualDisplay();
    this.unlinkedDom.infinityScroll.updateVirtualDisplay();
  };

  proto.toggleUnlinkedCollapsed = function () {
    this.setUnlinkedCollapsed(!this.unlinkedCollapsed, true);
  };

  proto.setUnlinkedCollapsed = async function (collapsed, animate) {
    if (collapsed === this.unlinkedCollapsed) return;
    this.unlinkedCollapsed = collapsed;
    await this.setSectionCollapsed(this.unlinkedHeaderEl, this.unlinkedDom, collapsed, animate);
    this.app.workspace.requestSaveLayout();
    this.backlinkDom.infinityScroll.updateVirtualDisplay();
    this.unlinkedDom.infinityScroll.updateVirtualDisplay();
  };

  proto.updateHeaderTooltip = function (headerEl, collapsed) {
    markItemCollapsed(headerEl, collapsed);
    setElementTooltip(headerEl, collapsed ? host.t.interface.tooltip.clickToExpand() : host.t.interface.tooltip.clickToCollapse(), { placement: this.tooltipPlacement });
  };

  proto.setSectionCollapsed = async function (headerEl, dom, collapsed, animate) {
    this.updateHeaderTooltip(headerEl, collapsed);
    await dom.toggle(collapsed, animate);
    this.update();
  };

  proto.onMetadataChanged = function (file) {
    const backlinkQueue = this.backlinkQueue;
    if (backlinkQueue) backlinkQueue.add(file);
    this.onFileChanged(file);
    if (file === this.unlinkedFile) {
      let aliasesKey = "";
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache) {
        const aliases = frontmatterAliases(cache.frontmatter);
        if (aliases) aliasesKey = JSON.stringify(aliases);
      }
      if (this.unlinkedAliases !== aliasesKey) this.recomputeUnlinked(file);
    }
  };

  proto.onFileChanged = function (file) {
    const unlinkedQueue = this.unlinkedQueue;
    if (unlinkedQueue) unlinkedQueue.add(file);
  };

  proto.onFileRename = function (file) {
    if (file === this.unlinkedFile) {
      this.recomputeBacklink(file);
      this.recomputeUnlinked(file);
    } else {
      this.onFileChanged(file);
      const backlinkQueue = this.backlinkQueue;
      if (backlinkQueue) backlinkQueue.add(file);
    }
  };

  proto.onFileDeleted = function (file) {
    const unlinkedQueue = this.unlinkedQueue;
    if (unlinkedQueue) unlinkedQueue.remove(file);
    const backlinkQueue = this.backlinkQueue;
    if (backlinkQueue) backlinkQueue.remove(file);
    this.backlinkDom.removeResult(file);
    this.unlinkedDom.removeResult(file);
  };

  proto.update = function () {
    const file = this.file;
    if (this.backlinkFile !== file) this.recomputeBacklink(file);
    if (this.unlinkedFile !== file) this.recomputeUnlinked(file);
    this.updateHeaderTooltip(this.backlinkHeaderEl, this.backlinkCollapsed);
    this.updateHeaderTooltip(this.unlinkedHeaderEl, this.unlinkedCollapsed);
  };

  /** The optional query filter: match(file, content) must not reject the candidate. */
  proto.passSearchFilter = function (file, content) {
    const searchQuery = this.searchQuery;
    if (searchQuery && !searchQuery.match(file, content)) return false;
    return true;
  };

  /** Scans every file for links that resolve to `file`; resolvedLinks gives a cheap pre-filter. */
  proto.recomputeBacklink = function (file) {
    const self = this;
    this.stopBacklinkSearch();
    const collapsed = this.backlinkCollapsed;
    const countEl = this.backlinkCountEl;
    if (collapsed) {
      countEl.hide();
      return;
    }
    this.backlinkFile = file;
    const app = this.app;
    const dom = this.backlinkDom;
    countEl.show();
    countEl.setText("0");
    dom.emptyResults();
    if (!file) return;

    const metadataCache = app.metadataCache;
    const updateCount = () => {
      countEl.setText(String(dom.getMatchCount()));
      dom.changed();
    };
    const queue = (this.backlinkQueue = new searchViewClasses.FileQueue({
      onStart: () => dom.startLoader(),
      onStop: () => {
        dom.stopLoader();
        updateCount();
      },
      onCancel: () => {
        self.backlinkQueue = null;
        updateCount();
      },
    }));
    dom.emptyResults();

    const candidates = app.vault.getFiles().filter((candidate) =>
      candidate.extension === "md" || Object.hasOwn(metadataCache.linkUpdaters, candidate.extension));
    candidates.sort(sortOrderComparator(dom.sortOrder));
    queue.addList(candidates);

    // A ref resolves to the pane's file when its linkpath dest equals it.
    const resolvesToFile = (sourcePath, ref) => {
      const dest = metadataCache.getFirstLinkpathDest(linkPath(ref.link), sourcePath);
      return dest && dest === file;
    };
    const hasDirectLink = (candidate) => {
      const resolved = metadataCache.resolvedLinks;
      return resolved.hasOwnProperty(candidate.path) && resolved[candidate.path].hasOwnProperty(file.path);
    };

    // Only files whose resolvedLinks mention the target are worth reading.
    const fileGenerator = (async function* () {
      for await (const candidate of queue.generator()) {
        if (hasDirectLink(candidate)) yield candidate;
        else dom.removeResult(candidate);
      }
    })();

    const batched = batchedIteration(app.vault.generateFiles(fileGenerator, true), { batchSize: 2, beforePause: updateCount });
    (async () => {
      for await (const { file: candidate, content } of batched) {
        if (queue.runnable.isCancelled()) return;
        if (candidate === file) continue;
        let hasMatches = false;
        const result = {};
        if (candidate.extension === "canvas") {
          const canvasPlugin = app.internalPlugins.getEnabledPluginById("canvas");
          if (!canvasPlugin) {
            dom.removeResult(candidate);
            continue;
          }
          const index = canvasPlugin.index.get(candidate);
          if (!index) {
            dom.removeResult(candidate);
            continue;
          }
          if (!self.passSearchFilter(candidate, content)) continue;
          const collectNode = (nodeId) => {
            if (!Object.hasOwn(index.caches, nodeId)) return;
            // one range per node cache: the callback returns exactly true on the first hit and the walker stops
            cacheHasMatchingRef(index.caches[nodeId], (ref) => {
              if (!hasRefPosition(ref) || !resolvesToFile(candidate.path, ref)) return false;
              const key = "canvas-" + nodeId;
              if (!result[key]) result[key] = [];
              result[key].push([ref.position.start.offset, ref.position.end.offset]);
              hasMatches = true;
              return true;
            });
          };
          for (const nodeId in index.caches) collectNode(nodeId);
          for (const embed of index.embeds) {
            const ref = { link: embed.file + (embed.subpath ?? ""), original: "" };
            if (resolvesToFile(candidate.path, ref)) hasMatches = true;
          }
        } else {
          const cache = metadataCache.getFileCache(candidate);
          if (!cache) {
            dom.removeResult(candidate);
            continue;
          }
          if (!self.passSearchFilter(candidate, content)) continue;
          const matched = [];
          cacheHasMatchingRef(cache, (ref) => {
            // push() returns a number, never === true, so the walker collects every match
            if (resolvesToFile(candidate.path, ref)) matched.push(ref);
            return false;
          });
          result.content = [];
          result.properties = [];
          for (const ref of matched) {
            if (hasRefPosition(ref)) {
              result.content.push([ref.position.start.offset, ref.position.end.offset]);
            } else if (hasRefKey(ref)) {
              const parts = ref.key.split(".");
              const key = parts[0];
              const subkeyParts = parts.slice(1);
              let subkey;
              if (subkeyParts.length) {
                subkey = [];
                for (const part of subkeyParts) {
                  const asNumber = Number(part);
                  subkey.push(Number.isNaN(asNumber) ? part : asNumber);
                }
              }
              result.properties.push({ key, subkey, pos: [0, ref.original.length] });
            }
            hasMatches = true;
          }
        }
        if (hasMatches) dom.addResult(candidate, result, content);
        else dom.removeResult(candidate);
      }
    })();
  };

  proto.stopBacklinkSearch = function () {
    const queue = this.backlinkQueue;
    if (queue && !queue.runnable.isCancelled()) {
      queue.runnable.cancel();
      this.backlinkFile = null;
    }
    this.backlinkQueue = null;
  };

  /** Plain-text occurrences of the file name and its aliases that are not inside links or frontmatter. */
  proto.recomputeUnlinked = function (file) {
    const self = this;
    this.stopUnlinkedSearch();
    const collapsed = this.unlinkedCollapsed;
    const countEl = this.unlinkedCountEl;
    if (collapsed) {
      countEl.hide();
      return;
    }
    this.unlinkedFile = file;
    this.unlinkedAliases = "";
    const app = this.app;
    const dom = this.unlinkedDom;
    countEl.show();
    countEl.setText("0");
    dom.emptyResults();
    if (!file) return;

    const patterns = [new RegExp(wholeWordPattern(file.basename), "gi")];
    const fileCache = app.metadataCache.getFileCache(file);
    if (fileCache) {
      const aliases = frontmatterAliases(fileCache.frontmatter);
      if (aliases) {
        for (const alias of aliases) {
          if (alias) patterns.push(new RegExp(wholeWordPattern(alias), "gi"));
        }
        this.unlinkedAliases = JSON.stringify(aliases);
      }
    }
    const updateCount = () => countEl.setText(String(dom.getMatchCount()));
    const queue = (this.unlinkedQueue = new searchViewClasses.FileQueue({
      onStart: () => dom.startLoader(),
      onStop: () => {
        dom.stopLoader();
        updateCount();
      },
      onCancel: () => {
        self.unlinkedQueue = null;
      },
    }));
    dom.emptyResults();

    const candidates = app.vault.getMarkdownFiles();
    candidates.sort(SEARCH_SORT_ORDERS[dom.sortOrder]);
    queue.addList(candidates);

    const batched = batchedIteration(app.vault.generateFiles(queue.generator(), true), { beforePause: updateCount });
    (async () => {
      for await (const { file: candidate, content } of batched) {
        if (candidate === file) continue;
        if (app.metadataCache.isUserIgnored(candidate.path)) continue;
        const cache = app.metadataCache.getFileCache(candidate);
        if (!self.passSearchFilter(candidate, content)) continue;

        // Every alias occurrence, as [start,end) ranges of the capture group.
        const ranges = [];
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content))) {
            const end = pattern.lastIndex;
            ranges.push([end - match[1].length, end]);
          }
        }
        const result = { content: [] };
        let hasUnlinked = false;
        for (const range of ranges) {
          // Skip occurrences that sit inside a link/embed or the frontmatter block.
          let inside = cacheHasLinkRange(cache, (ref) =>
            ref.position.start.offset <= range[0] && ref.position.end.offset >= range[1]);
          if (!inside && cache && cache.frontmatterPosition) {
            const fm = cache.frontmatterPosition;
            if (fm.start.offset <= range[0] && fm.end.offset >= range[1]) inside = true;
          }
          if (!inside) {
            hasUnlinked = true;
            result.content.push(range);
          }
        }
        if (hasUnlinked) {
          const item = dom.addResult(candidate, result, content);
          self.addLinkFunction(item, file, candidate);
          item.separateMatches = true;
        } else {
          dom.removeResult(candidate);
        }
      }
    })();
  };

  proto.stopUnlinkedSearch = function () {
    const queue = this.unlinkedQueue;
    if (queue && !queue.runnable.isCancelled()) {
      queue.runnable.cancel();
      this.unlinkedFile = null;
    }
    this.unlinkedQueue = null;
  };

  /** Adds the "link this mention" button to every match row of an unlinked-mentions result. */
  proto.addLinkFunction = function (resultItem, targetFile, sourceFile) {
    const self = this;
    resultItem.onMatchRender = function (match, el) {
      el.createEl("button", { cls: "search-result-file-match-replace-button", text: linksT().labelLinkButtonText() })
        .addEventListener("click", async (event) => {
          event.preventDefault();
          el.detach();
          resultItem.invalidate();
          const vault = self.app.vault;
          const start = match[0];
          const end = match[1];
          const content = await vault.read(sourceFile);
          const mention = content.slice(start, end);
          const link = self.app.fileManager.generateMarkdownLink(targetFile, sourceFile.path, "", mention);
          const next = content.slice(0, start) + link + content.slice(end);
          await vault.modify(sourceFile, next);
        });
    };
  };

  linkPanes.BacklinkComponent = BacklinkComponent;
  return BacklinkComponent;
}

// =====================================================================================================================
// Backlinks view
// =====================================================================================================================

/** The "Backlinks" sidebar view (`backlink`): icon, title from the backlinks plugin, delegates to BacklinkComponent. */
export function defineBacklinkView(host) {
  const backlinksT = () => host.t.plugins.backlinks;

  function BacklinkView(leaf) {
    const self = linkPanes.LinkPaneView.call(this, leaf) || this;
    self.icon = "links-coming-in";
    self.backlink = self.addChild(new linkPanes.BacklinkComponent(self.app, self.contentEl));
    self.requestUpdate();
    return self;
  }
  inherit(BacklinkView, linkPanes.LinkPaneView);
  const proto = BacklinkView.prototype;

  proto.getDisplayText = function () {
    if (!this.file || host.Platform.isMobile) return backlinksT().name();
    return backlinksT().tabTitle({ displayText: host.FileView.prototype.getDisplayText.call(this) });
  };

  proto.getViewType = function () { return VIEW_TYPE_BACKLINK; };
  proto.canAcceptExtension = function () { return true; };

  proto.getState = function () {
    const state = host.FileView.prototype.getState.call(this);
    return Object.assign(state, this.backlink.getState());
  };

  proto.setState = async function (state, result) {
    await host.FileView.prototype.setState.call(this, state, result);
    await this.backlink.setState(state);
  };

  proto.showSearch = function () {
    this.backlink.setShowSearch(true);
    this.backlink.searchComponent.inputEl.focus();
  };

  proto.onResize = function () {
    this.backlink.onResize();
  };

  proto.update = function () {
    this.leaf.updateHeader();
    const backlink = this.backlink;
    backlink.file = this.file;
    backlink.tooltipPlacement = this.getSideTooltipPlacement();
    backlink.update();
  };

  linkPanes.BacklinkView = BacklinkView;
  return BacklinkView;
}

// =====================================================================================================================
// Outgoing links pane body
// =====================================================================================================================

/** The virtualised root the outgoing "Links" section hangs its items on (a TreeChildren owner with a pusher). */
function defineOutgoingLinkList(host) {
  function OutgoingLinkList(el) {
    this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    this.vChildren = new host.TreeChildren(this);
    this.pusherEl = makeTreePusher();
    this.el = el;
    this.childrenEl = el;
  }
  return OutgoingLinkList;
}

/** One outgoing-link row: link text, resolved destination (or a "not created" hint) and click/contextmenu/drag. */
function defineOutgoingLinkItem(host) {
  const linksT = () => host.t.plugins.outgoingLinks;

  function OutgoingLinkItem(component, linktext, path, subpath, sourcePath, destFile) {
    this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    this.invalidated = false;
    this.sourcePath = sourcePath;
    this.pos = 0;

    const app = component.app;
    const selfEl = (this.el = createDiv("tree-item-self is-clickable outgoing-link-item"));
    const iconEl = selfEl.createSpan("tree-item-icon");

    let icon = "lucide-link";
    let label = path;
    let subtext = "";
    if (destFile) {
      if (subpath) {
        const resolved = resolveSubpath(app.metadataCache.getFileCache(destFile), subpath);
        if (resolved) {
          if (resolved.type === "heading") {
            icon = "heading-glyph";
            label = resolved.current.heading;
            subtext = path;
          } else if (resolved.type === "block") {
            icon = "lucide-layout-list";
            label = resolved.block.id;
            subtext = path;
          }
        } else {
          icon = "lucide-file-question";
          label = subpath;
          subtext = path;
        }
      } else {
        icon = "lucide-link";
        if (destFile.parent.path !== "/") subtext = parentPath(destFile.path);
      }
    } else {
      icon = "lucide-file-plus";
      setElementTooltip(selfEl, linksT().tooltipNotCreated());
    }
    host.setIcon(iconEl, icon);

    const inner = selfEl.createDiv({ cls: "tree-item-inner" });
    inner.createDiv({ cls: "tree-item-inner-text", text: label });
    if (subtext) inner.createDiv({ cls: "tree-item-inner-subtext", text: subtext });

    selfEl.onClickEvent((event) => {
      if (event.button === 0 || event.button === 1) {
        app.workspace.openLinkText(linktext, sourcePath, host.Keymap.isModEvent(event));
      }
    });
    selfEl.addEventListener("contextmenu", (event) => {
      const menu = new host.Menu().addSections(["title", "open", "action", "view", "info", "", "danger"]);
      if (app.workspace.handleLinkContextMenu(menu, linktext, sourcePath)) {
        event.preventDefault();
        menu.setParentElement(selfEl).showAtMouseEvent(event);
      }
    });
    selfEl.addEventListener("mouseover", (event) => {
      if (event.defaultPrevented) return;
      if (!host.pointerEntered(event, selfEl)) return;
      event.preventDefault();
      app.workspace.trigger("hover-link", {
        event,
        source: "search",
        hoverParent: component,
        targetEl: selfEl,
        linktext,
        sourcePath,
      });
    });
    if (destFile) {
      const dragManager = app.dragManager;
      dragManager.handleDrag(selfEl, (event) => dragManager.dragFile(event, destFile));
    }
  }
  return OutgoingLinkItem;
}

/** The outgoing-links component: resolved "Links" rows plus an "Unlinked mentions" SearchResults section. */
export function defineOutgoingLinkComponent(host) {
  const linksT = () => host.t.plugins.outgoingLinks;
  const OutgoingLinkList = defineOutgoingLinkList(host);
  const OutgoingLinkItem = defineOutgoingLinkItem(host);

  function OutgoingLinkComponent(app, containerEl, scrollParent) {
    const self = host.Component.call(this) || this;
    self.showSearch = false;
    self.outgoingFile = null;
    self.linksCollapsed = false;
    self.linksHeaderEl = null;
    self.linksCountEl = null;
    self.linksQueue = null;
    self.unlinkedFile = null;
    self.unlinkedCollapsed = false;
    self.unlinkedHeaderEl = null;
    self.unlinkedCountEl = null;
    self.unlinksQueue = null;
    self.unlinkedDomInfo = new WeakMap();
    self.requestUpdate = debounceCall(self.update.bind(self), 50);
    self.app = app;
    self.tooltipPlacement = undefined;
    const scroll = scrollParent || containerEl;

    const linksHeaderEl = (self.linksHeaderEl = containerEl.createDiv("tree-item-self is-clickable"));
    linksHeaderEl.createSpan("tree-item-icon collapse-icon", (icon) => host.setIcon(icon, "right-triangle"));
    linksHeaderEl.createDiv({ cls: "tree-item-inner", text: linksT().labelLinks() });
    linksHeaderEl.addEventListener("click", self.toggleLinksCollapsed.bind(self));
    self.linksCountEl = linksHeaderEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
    self.outgoingLinkDom = new OutgoingLinkList(containerEl.createDiv("search-result-container"));
    self.outgoingLinkInfinityScroller = new host.InfinityScroll(scroll);
    self.outgoingLinkInfinityScroller.rootEl = self.outgoingLinkDom;

    const unlinkedHeaderEl = (self.unlinkedHeaderEl = containerEl.createDiv("tree-item-self is-clickable"));
    unlinkedHeaderEl.createSpan("tree-item-icon collapse-icon", (icon) => host.setIcon(icon, "right-triangle"));
    unlinkedHeaderEl.createDiv({ cls: "tree-item-inner", text: linksT().labelUnlinkedMentions() });
    unlinkedHeaderEl.addEventListener("click", self.toggleUnlinkedCollapsed.bind(self));
    self.unlinkedCountEl = unlinkedHeaderEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
    self.unlinkedDom = new searchViewClasses.SearchResults(app, containerEl.createDiv("search-result-container"), linksT().labelUnlinkedMentions(), scroll);

    self.setUnlinkedCollapsed(true, false);
    return self;
  }
  inherit(OutgoingLinkComponent, host.Component);
  const proto = OutgoingLinkComponent.prototype;

  proto.onload = function () {
    const { vault, metadataCache } = this.app;
    this.registerEvent(metadataCache.on("resolve", this.onFileResolved, this));
    this.registerEvent(vault.on("delete", this.onFileDeleted, this));
  };

  proto.onResize = function () {
    this.outgoingLinkInfinityScroller.onResize();
    this.unlinkedDom.onResize();
  };

  proto.toggleLinksCollapsed = function () {
    this.setLinksCollapsed(!this.linksCollapsed, true);
  };

  proto.setLinksCollapsed = async function (collapsed, animate) {
    if (collapsed === this.linksCollapsed) return;
    this.linksCollapsed = collapsed;
    this.updateHeaderTooltip(this.linksHeaderEl, collapsed);
    await toggleElementVisibility(this.outgoingLinkDom.el, collapsed, animate);
    if (!collapsed) this.outgoingLinkInfinityScroller.invalidateAll();
    this.update();
    this.app.workspace.requestSaveLayout();
    this.outgoingLinkInfinityScroller.updateVirtualDisplay();
    this.unlinkedDom.infinityScroll.updateVirtualDisplay();
  };

  proto.toggleUnlinkedCollapsed = function () {
    this.setUnlinkedCollapsed(!this.unlinkedCollapsed, true);
  };

  proto.setUnlinkedCollapsed = async function (collapsed, animate) {
    if (collapsed === this.unlinkedCollapsed) return;
    this.unlinkedCollapsed = collapsed;
    await this.setSectionCollapsed(this.unlinkedHeaderEl, this.unlinkedDom, collapsed, animate);
    this.app.workspace.requestSaveLayout();
    this.outgoingLinkInfinityScroller.updateVirtualDisplay();
    this.unlinkedDom.infinityScroll.updateVirtualDisplay();
  };

  proto.updateHeaderTooltip = function (headerEl, collapsed) {
    markItemCollapsed(headerEl, collapsed);
    setElementTooltip(headerEl, collapsed ? host.t.interface.tooltip.clickToExpand() : host.t.interface.tooltip.clickToCollapse(), { placement: this.tooltipPlacement });
  };

  proto.setSectionCollapsed = async function (headerEl, dom, collapsed, animate) {
    this.updateHeaderTooltip(headerEl, collapsed);
    await dom.toggle(collapsed, animate);
    this.update();
  };

  proto.onFileResolved = function (file) {
    if (file === this.file) {
      this.outgoingFile = null;
      this.unlinkedFile = null;
      this.update();
    }
  };

  proto.onFileDeleted = function () {
    this.unlinkedFile = null;
    this.requestUpdate();
  };

  proto.update = function () {
    const file = this.file;
    if (this.outgoingFile !== file) this.recomputeLinks();
    if (this.unlinkedFile !== file) this.recomputeUnlinked();
    this.updateHeaderTooltip(this.linksHeaderEl, this.linksCollapsed);
    this.updateHeaderTooltip(this.unlinkedHeaderEl, this.unlinkedCollapsed);
  };

  /** Resolves every link ref of the file into OutgoingLinkItem rows, deduplicated by destination. */
  proto.recomputeLinks = function () {
    const self = this;
    const previous = this.linksQueue;
    if (previous && !previous.runnable.isCancelled()) {
      previous.runnable.cancel();
      this.outgoingFile = null;
    }
    this.linksQueue = null;
    const collapsed = this.linksCollapsed;
    const countEl = this.linksCountEl;
    if (collapsed) {
      countEl.hide();
      return;
    }
    const file = this.file;
    this.outgoingFile = file;
    const dom = this.outgoingLinkDom;
    const scroller = this.outgoingLinkInfinityScroller;
    scroller.queueCompute();
    countEl.show();
    countEl.setText("0");
    if (!file || file.extension !== "md") {
      dom.vChildren.clear();
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      dom.vChildren.clear();
      return;
    }

    const links = [];
    cacheHasMatchingRef(cache, (ref) => {
      links.push({ linktext: ref.link, pos: hasRefPosition(ref) ? ref.position.start.offset : 0 });
      return false;
    });
    links.sort((a, b) => a.pos - b.pos);
    if (links.length === 0) {
      dom.vChildren.clear();
      return;
    }

    for (const child of dom.vChildren.children) child.invalidated = true;

    const refresh = () => {
      const children = dom.vChildren;
      const sorted = children.children.slice().sort((a, b) => a.pos - b.pos);
      // Drop invalidated rows that precede the last processed position (replaced duplicates).
      for (let i = 0; i < sorted.length; i++) {
        const child = sorted[i];
        if (lastPos !== -1 && child.pos > lastPos) break;
        if (child.invalidated) {
          sorted.splice(i, 1);
          i--;
        }
      }
      children.setChildren(sorted);
      scroller.queueCompute();
      countEl.setText(String(children.children.length));
    };

    let lastPos = 0;
    const queue = (this.linksQueue = new searchViewClasses.FileQueue({
      onStart: () => {},
      onStop: () => {
        lastPos = -1;
        refresh();
      },
      onCancel: () => {
        self.linksQueue = null;
      },
    }));
    const seen = new Set();
    queue.addList(links);
    const batched = batchedIteration(queue.generator(), { batchSize: 20, beforePause: refresh });
    (async () => {
      for await (const entry of batched) {
        const { linktext, pos } = entry;
        const { path, subpath } = parseLinktext(linktext);
        let linkPathResolved = path;
        const dest = this.app.metadataCache.getFirstLinkpathDest(linkPathResolved, file.path);
        if (!dest) linkPathResolved = dropMdSuffix(linkPathResolved);
        const key = (dest ? dest.path : linkPathResolved) + subpath;
        if (seen.has(key)) continue;
        seen.add(key);
        const item = new OutgoingLinkItem(this, linktext, linkPathResolved, subpath, file.path, dest);
        item.pos = pos;
        lastPos = pos;
        dom.vChildren.addChild(item);
      }
    })();
  };

  /** Plain-text mentions of other files' names/aliases inside this file, as match rows with link buttons. */
  proto.recomputeUnlinked = async function () {
    const self = this;
    const previous = this.unlinksQueue;
    if (previous && !previous.runnable.isCancelled()) {
      previous.runnable.cancel();
      this.unlinkedFile = null;
    }
    this.unlinksQueue = null;
    const collapsed = this.unlinkedCollapsed;
    const countEl = this.unlinkedCountEl;
    if (collapsed) {
      countEl.hide();
      return;
    }
    const file = this.file;
    this.unlinkedFile = file;
    const dom = this.unlinkedDom;
    const app = this.app;
    const infoMap = this.unlinkedDomInfo;
    countEl.show();
    countEl.setText("0");
    if (!file || file.extension !== "md") {
      dom.emptyResults();
      return;
    }
    const cache = app.metadataCache.getFileCache(file);
    const content = await app.vault.cachedRead(file);

    // text (lowercased) -> { text, files: [TFile] } for every basename/alias of every markdown file.
    const mentions = new Map();
    const addMention = (text, target) => {
      const key = text.toLowerCase();
      let entry = mentions.get(key);
      if (!entry) {
        entry = { text: key, files: [] };
        mentions.set(key, entry);
      }
      if (!entry.files.includes(target)) entry.files.push(target);
    };
    for (const candidate of app.vault.getMarkdownFiles()) {
      if (candidate === file) continue;
      if (app.metadataCache.isUserIgnored(candidate.path)) continue;
      addMention(candidate.basename, candidate);
      const candidateCache = app.metadataCache.getFileCache(candidate);
      const aliases = candidateCache && frontmatterAliases(candidateCache.frontmatter);
      if (aliases) {
        for (const alias of aliases) {
          if (alias) addMention(alias, candidate);
        }
      }
    }
    const sorted = Array.from(mentions.values()).sort((a, b) => compareSearchText(a.text, b.text));

    let result = dom.getResult(file);
    if (result) {
      // Drop match rows whose mention text is no longer mentioned anywhere; keep everything else.
      const kept = result.vChildren.children.slice().filter((child) => {
        if (!(child instanceof searchViewClasses.SearchMatchResult)) return true;
        const info = infoMap.get(child);
        return !!(info && mentions.has(info.text));
      });
      result.vChildren.setChildren(kept);
      result.content = content;
    } else {
      dom.emptyResults();
      result = dom.addResult(file, { content: [] }, content, false);
    }
    result.separateMatches = true;

    const recount = () => {
      result.vChildren.sort((a, b) =>
        Array.isArray(a.matches) ? (Array.isArray(b.matches) ? a.matches[0][0] - b.matches[0][0] : 1) : -1);
      dom.infinityScroll.queueCompute();
      countEl.setText(String(result.vChildren.size()));
    };

    const queue = (this.unlinksQueue = new searchViewClasses.FileQueue({
      onStart: () => {},
      onStop: recount,
      onCancel: () => {
        self.linksQueue = null;
      },
    }));
    queue.addList(sorted);
    const batched = batchedIteration(queue.generator(), { beforePause: recount });
    const frontmatterEnd = cache && cache.frontmatterPosition ? cache.frontmatterPosition.end.offset : 0;
    const lowered = content.toLowerCase();
    for await (const info of batched) {
      self.processInfo(file, content, lowered, cache, frontmatterEnd, result, info);
    }
  };

  /** Finds every whole-word occurrence of one mention text and turns the non-link ones into match rows. */
  proto.processInfo = function (file, content, lowered, cache, frontmatterEnd, result, info) {
    const files = info.files;
    const text = info.text;
    // Drop this mention's stale rows, keep the other mentions' rows.
    const kept = result.vChildren.children.slice().filter((child) => {
      if (!(child instanceof searchViewClasses.SearchMatchResult)) return true;
      const existing = this.unlinkedDomInfo.get(child);
      return existing && existing.text !== text;
    });
    result.vChildren.setChildren(kept);

    const pattern = wholeWordPattern(text);
    const regex = new RegExp(pattern, "giy");
    // wholeWordPattern may start with a non-capturing prefix; the sticky offset compensates for it.
    const offset = pattern.startsWith("(?:") ? -1 : 0;
    let position = lowered.indexOf(text, frontmatterEnd);
    while (position !== -1) {
      regex.lastIndex = position + offset;
      const start = position;
      const end = position + text.length;
      position = lowered.indexOf(text, end);
      if (!regex.test(content)) continue;
      // Skip mentions inside a cached link/embed range.
      if (cacheHasLinkRange(cache, (ref) =>
        ref.position.start.offset <= start && ref.position.end.offset >= end)) continue;
      const range = [start, end];
      const item = this.renderMatch(file, result, files, cache, content, range);
      this.unlinkedDomInfo.set(item, info);
      result.vChildren.addChild(item);
    }
  };

  /** Builds one match row for an unlinked mention; its hover area offers a link button per destination file. */
  proto.renderMatch = function (file, result, files, cache, content, range) {
    const self = this;
    const app = this.app;
    const bounds = contextLineBounds(content, range);
    const start = bounds[0];
    const end = bounds[1];
    const before = bounds[2];
    const after = bounds[3];
    const item = new searchViewClasses.SearchMatchResult(result, content, cache, start, end, [range]);
    item.onMatchRender = function (match, el) {
      const container = el.createDiv({ cls: "search-result-file-match-destination-file-container" });
      const addFile = (target) => {
        const row = container.createDiv({ cls: "search-result-file-match-destination-file" });
        row.createSpan({ cls: "search-result-file-match-destination-file-icon" }, (icon) => host.setIcon(icon, "lucide-link"));
        row.createSpan({ cls: "search-result-file-match-destination-file-name", text: target.basename });
        let tooltip = linksT().tooltipLinkFile();
        if (target.parent.path !== "/") tooltip = withoutExtension(target.path) + "\n\n" + tooltip;
        setElementTooltip(row, tooltip);
        row.addEventListener("click", async (event) => {
          event.preventDefault();
          el.detach();
          result.invalidate();
          const vault = app.vault;
          const matchStart = match[0];
          const matchEnd = match[1];
          if (!target) return;
          const current = await vault.read(file);
          const mention = current.slice(matchStart, matchEnd);
          let link = app.fileManager.generateMarkdownLink(target, file.path, "", mention);
          const inTable = cache && cache.sections && cache.sections.some((section) =>
            section.type === "table" && section.position.start.offset <= matchStart && section.position.end.offset >= matchEnd);
          if (inTable) link = link.replace("|", "\\|");
          const next = current.slice(0, matchStart) + link + current.slice(matchEnd);
          await vault.modify(file, next);
        });
      };
      for (const target of files) addFile(target);
    };
    item.render(before, after);
    return item;
  };

  linkPanes.OutgoingLinkComponent = OutgoingLinkComponent;
  return OutgoingLinkComponent;
}

// =====================================================================================================================
// Outgoing links view
// =====================================================================================================================

/** The "Outgoing links" sidebar view (`outgoing-link`): delegates to OutgoingLinkComponent. */
export function defineOutgoingLinkView(host) {
  const linksT = () => host.t.plugins.outgoingLinks;

  function OutgoingLinkView(leaf) {
    const self = linkPanes.LinkPaneView.call(this, leaf) || this;
    self.icon = "links-going-out";
    self.outgoingLink = self.addChild(new linkPanes.OutgoingLinkComponent(self.app, self.contentEl.createDiv("outgoing-link-pane")));
    self.requestUpdate();
    return self;
  }
  inherit(OutgoingLinkView, linkPanes.LinkPaneView);
  const proto = OutgoingLinkView.prototype;

  proto.getDisplayText = function () {
    if (!this.file || host.Platform.isMobile) return linksT().name();
    return linksT()("tab-title", { displayText: host.FileView.prototype.getDisplayText.call(this) });
  };

  proto.getViewType = function () { return VIEW_TYPE_OUTGOING; };
  proto.canAcceptExtension = function () { return true; };

  proto.getState = function () {
    const state = host.FileView.prototype.getState.call(this);
    state.linksCollapsed = this.outgoingLink.linksCollapsed;
    state.unlinkedCollapsed = this.outgoingLink.unlinkedCollapsed;
    return state;
  };

  proto.setState = async function (state, result) {
    await host.FileView.prototype.setState.call(this, state, result);
    const linksCollapsed = state.linksCollapsed;
    const unlinkedCollapsed = state.unlinkedCollapsed;
    if (isBoolean(linksCollapsed)) await this.outgoingLink.setLinksCollapsed(linksCollapsed, false);
    if (isBoolean(unlinkedCollapsed)) await this.outgoingLink.setUnlinkedCollapsed(unlinkedCollapsed, false);
  };

  proto.onResize = function () {
    this.outgoingLink.onResize();
  };

  proto.update = function () {
    this.leaf.updateHeader();
    const outgoingLink = this.outgoingLink;
    outgoingLink.file = this.file;
    outgoingLink.tooltipPlacement = this.getSideTooltipPlacement();
    outgoingLink.update();
  };

  linkPanes.OutgoingLinkView = OutgoingLinkView;
  return OutgoingLinkView;
}
