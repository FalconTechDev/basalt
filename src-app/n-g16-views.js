import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { ng15MakeTreePusher } from "./n-g15-tree.js";
import { ng16Lower, ng16Compare, ng16PluginT, ng16PropT, ng16Reserved } from "./n-g16-shared.js";

export function ng16PropertyItem(host) {
  function I(tree, item) { const self = host.TreeItem.call(this) || this; self.tree = tree; self.view = tree.view; self.item = item; self.pusherEl = ng15MakeTreePusher(); self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false }; self.setClickable(true); self.titleEl = self.innerEl.createSpan({ cls: "tree-item-inner-text" }); self.iconEl = self.innerEl.createSpan({ cls: "tree-item-icon" }); self.flairEl = self.innerEl.createSpan({ cls: "tree-item-flair" }); return self; }
  inherit(I, host.TreeItem); const p = I.prototype;
  p.setProperty = function (info) { this.item.info = info; this.titleEl.setText(info.name); this.flairEl.setText(String(info.occurrences || 0)); const w = this.view.app.metadataTypeManager.getWidget(info.widget); host.setIcon(this.iconEl, (w && w.icon) || "lucide-text"); };
  p.onSelfClick = function (e) { const v = this.view; const name = this.item.info.name; if (e && host.Keymap.isModEvent(e)) { const q = v.searchComponent.getValue(); if (q.indexOf(name) >= 0) v.searchComponent.setValue(q.replace(name, "").trim()); else v.searchComponent.setValue((q + " " + name).trim()); v.updateSearch(); return; } const plugin = v.app.internalPlugins.getPluginById("global-search"); if (plugin && plugin.instance) plugin.instance.openGlobalSearch("[\"" + name + "\"]"); };
  p.getDisplayText = function () { return this.item.info.name; };
  return I;
}

export function ng16AllPropertiesView(host) {
  function V(leaf) {
    const self = host.ItemView.call(this, leaf) || this; self.icon = "lucide-archive"; self.sortOrder = "frequency"; self.showSearch = false; self.searchQuery = ""; self.scope = new host.Scope(self.app.scope); self.emptyEl = self.contentEl.createDiv({ cls: "pane-empty properties-pane-empty", text: ng16PluginT(host).labelNoProperties() }); const header = new host.ViewHeader(self.app, self.containerEl); self.sortButtonEl = header.addNavButton("lucide-arrow-down-a-z", ng16PluginT(host).labelSortByNameAToZ(), () => self.cycleSort()); self.searchButtonEl = header.addNavButton("lucide-search", "Search", () => self.setShowSearch(!self.showSearch)); self.searchComponent = new host.SearchComponent(header.navHeaderEl).setPlaceholder("Search"); self.searchComponent.onChange((q) => { self.searchQuery = q; self.updateSearch(); }); self.tree = new host.Tree(self, { app: self.app, containerEl: self.contentEl, id: "all-properties", scope: self.scope }); self.requestUpdate = debounceCall(() => self.update(), 100); return self;
  }
  inherit(V, host.ItemView); const p = V.prototype;
  p.getViewType = function () { return "all-properties"; };
  p.getDisplayText = function () { return ng16PluginT(host).nameGlobal(); };
  p.getState = function () { const s = host.ItemView.prototype.getState.call(this); return Object.assign(s, { sortOrder: this.sortOrder, showSearch: this.showSearch, searchQuery: this.searchQuery }); };
  p.setState = function (state, result) { if (state && state.sortOrder && ["alphabetical","alphabeticalReverse","frequency","frequencyReverse"].includes(state.sortOrder)) this.sortOrder = state.sortOrder; if (state && typeof state.showSearch === "boolean") this.showSearch = state.showSearch; if (state && typeof state.searchQuery === "string") { this.searchQuery = state.searchQuery; this.searchComponent.setValue(state.searchQuery); } this.updateSearch(); this.update(); if (host.ItemView.prototype.setState) return host.ItemView.prototype.setState.call(this, state, result); };
  p.setShowSearch = function (on) { this.showSearch = on; this.searchComponent.containerEl.style.display = on ? "" : "none"; this.requestSaveLayout && this.requestSaveLayout(); if (!on) { this.searchQuery = ""; this.searchComponent.setValue(""); this.updateSearch(); } };
  p.updateSearch = function () { this.searchQuery = this.searchComponent && this.searchComponent.getValue ? this.searchComponent.getValue() : this.searchQuery; this.update(); };
  p.setSortOrder = function (o) { if (["alphabetical","alphabeticalReverse","frequency","frequencyReverse"].indexOf(o) >= 0) this.sortOrder = o; this.update(); };
  p.cycleSort = function () { const orders = ["frequency","frequencyReverse","alphabetical","alphabeticalReverse"]; this.sortOrder = orders[(orders.indexOf(this.sortOrder) + 1) % orders.length]; this.update(); };
  p.update = function () {
    const infos = this.app.metadataTypeManager.getAllProperties() || {}; let rows = Object.values(infos); const q = (this.searchQuery || "").trim().toLowerCase(); if (q) rows = rows.filter((r) => String(r.name || "").toLowerCase().indexOf(q) >= 0); const rev = this.sortOrder.slice(-7) === "Reverse"; if (this.sortOrder.indexOf("alphabetical") === 0) rows.sort((a,b)=>{ const c = ng16Compare(String(a.name||"").toLowerCase(), String(b.name||"").toLowerCase()); return rev ? -c : c; }); else rows.sort((a,b)=>{ const c = (b.occurrences||0)-(a.occurrences||0); if (c) return rev ? -c : c; const n = ng16Compare(String(a.name||"").toLowerCase(), String(b.name||"").toLowerCase()); return rev ? -n : n; });
    this.emptyEl.style.display = rows.length ? "none" : ""; const items = rows.map((info) => { const it = new (ng16PropertyItem(host))(this.tree, { info }); it.setProperty(info); return it; }); this.tree.root.vChildren.setChildren(items); if (this.tree.infinityScroll && this.tree.infinityScroll.queueCompute) this.tree.infinityScroll.queueCompute();
  };
  p.onload = function () { const self = this; this.registerEvent(this.app.vault.on("delete", () => this.requestUpdate())); this.registerEvent(this.app.metadataCache.on("finished", () => this.requestUpdate())); this.registerEvent(this.app.metadataTypeManager.on("changed", () => this.requestUpdate())); this.update(); };
  p.onResize = function () { if (this.tree && this.tree.infinityScroll && this.tree.infinityScroll.onResize) this.tree.infinityScroll.onResize(); };
  return V;
}

export function ng16FilePropertiesView(host) {
  function V(leaf, plugin) { const self = host.ItemView.call(this, leaf) || this; self.plugin = plugin; self.icon = "lucide-info"; self.file = null; self.rawFrontmatter = null; self.frontmatter = null; self.modifyingFile = null; self.metadataEditor = new host.MetadataEditor(self.app, self); self.contentEl.appendChild(self.metadataEditor.containerEl); self.emptyEl = self.contentEl.createDiv({ cls: "pane-empty", text: "No properties" }); self.metadataEditor.containerEl.style.display = "none"; self.contentEl.addEventListener("click", (e) => { if (e.target === self.contentEl) self.metadataEditor.containerEl.focus(); }); self.contentEl.addEventListener("contextmenu", (e) => { if (e.target === self.contentEl && self.canShowProperties()) self.metadataEditor.showPropertiesMenu(e); }); return self; }
  inherit(V, host.ItemView); const p = V.prototype;
  p.getViewType = function () { return "file-properties"; };
  p.getDisplayText = function () { return this.file ? ng16PluginT(host).tabTitle({ displayText: this.file.basename }) : ng16PluginT(host).nameLocal(); };
  p.getFile = function () { return this.file; };
  p.getHoverSource = function () { return "properties"; };
  p.canShowProperties = function () { return true; };
  p.canAcceptExtension = function () { return true; };
  p.shiftFocusAfter = function () {}; p.shiftFocusBefore = function () {}; p.onMarkdownFold = function () {};
  p.isSupportedFile = function (f) { return !!f && f.extension === "md"; };
  p.readSupportedFile = async function (f) { try { return await this.app.vault.cachedRead(f); } catch { return ""; } };
  p.saveFrontmatter = async function (obj) { const f = this.file; if (!f || f.extension !== "md" || f !== this.modifyingFile) return; const content = await this.app.vault.read(f); const data = host.spliceFrontmatter(content, obj); await this.app.vault.process(f, () => data); };
  p.updateFrontmatter = function (file, content) { if (!this.isSupportedFile(file)) { this.frontmatter = null; return; } const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content || ""); const raw = m ? m[1] : ""; if (raw === this.rawFrontmatter) return; this.rawFrontmatter = raw; try { const parsed = host.parseYaml(raw) ?? {}; this.frontmatter = (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null; } catch { this.frontmatter = null; } };
  p.update = function () { this.metadataEditor.synchronize(this.frontmatter); this.updateEmptyState(); };
  p.updateEmptyState = function () { const empty = !this.frontmatter || Object.keys(this.frontmatter).length === 0; this.emptyEl.style.display = empty ? "" : "none"; this.metadataEditor.containerEl.style.display = empty ? "none" : ""; };
  p.onLoadFile = async function (file) { this.file = file; const content = await this.readSupportedFile(file); this.updateFrontmatter(file, content); this.modifyingFile = file.extension === "md" ? file : null; this.update(); if (host.ItemView.prototype.onLoadFile) return host.ItemView.prototype.onLoadFile.call(this, file); };
  p.onUnloadFile = function (file) { if (file === this.file) { this.modifyingFile = null; this.rawFrontmatter = null; this.updateFrontmatter(null, ""); this.metadataEditor.clear(); } if (host.ItemView.prototype.onUnloadFile) return host.ItemView.prototype.onUnloadFile.call(this, file); };
  p.onFileChange = function (file) { if (file === this.file) this.onLoadFile(file); };
  p.onQuickPreview = p.onFileChange;
  p.handleCut = function (e) { this.metadataEditor.handleCut(e); }; p.handleCopy = function (e) { this.metadataEditor.handleCopy(e); }; p.handlePaste = function (e) { if (e.clipboardData.getData("basalt/properties")) this.metadataEditor.handlePaste(e); };
  p.setEphemeralState = function (state) { if (state && state.focus) this.metadataEditor.containerEl.focus(); };
  return V;
}




