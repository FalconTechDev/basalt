// g38 clean-room: "Page preview" core plugin + its settings tab (spec g38 Part 1).
// Hover gating with per-source "require modifier" overrides, the armed
// press-modifier-to-preview session, and the settings tab toggles.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng12PublishHoverMove } from "./n-g12-s09-core.js";

const ng38PPTabs = new WeakMap(); // host -> PagePreviewSettingTab class

/** Display name of the "Mod" key for the platform (was the missing s04-menu import). */
function ng38PPModKey(host) {
  return host.isMacLike ? "⌘" : "Ctrl";
}

function ng38PPBuildTab(host) {
  function PagePreviewSettingTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.app = app;
    self.plugin = plugin;
    self.instance = instance;
    self.icon = "scan-eye";
    return self;
  }
  inherit(PagePreviewSettingTab, host.PluginInstanceSettingTab);

  PagePreviewSettingTab.prototype.display = function () {
    const el = this.containerEl;
    if (el.empty) el.empty();
    else if (el.replaceChildren) el.replaceChildren();
    const t = host.t.plugins.pagePreview;
    const group = new host.SettingGroup(el);
    group.setHeading(t.labelRequireMod({ key: ng38PPModKey(host) }));
    const sources = (this.app.workspace && this.app.workspace.hoverLinkSources) || {};
    const overrides = this.instance.overrides || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
    for (const id of Object.keys(sources)) {
      const source = sources[id];
      group.addSetting((setting) => {
        setting.setName(source.display).addToggle((toggle) => {
          toggle.setValue(has(id) ? overrides[id] : source.defaultMod);
          toggle.onChange((value) => {
            if (value === source.defaultMod) delete overrides[id];
            else overrides[id] = value;
            this.plugin.saveData(overrides);
          });
        });
      });
    }
  };
  return PagePreviewSettingTab;
}

function ng38PPTabClass(host) {
  let cls = ng38PPTabs.get(host);
  if (!cls) { cls = ng38PPBuildTab(host); ng38PPTabs.set(host, cls); }
  return cls;
}

export function ng38PagePreviewSettingTab(host) {
  return ng38PPTabClass(host);
}

export function ng38PagePreviewPlugin(host) {
  function PagePreviewPlugin() {
    this.id = "page-preview";
    this.name = host.t.plugins.pagePreview.name();
    this.description = host.t.plugins.pagePreview.desc();
    this.defaultOn = true;
    this.overrides = {};
    this.app = null;
  }

  PagePreviewPlugin.prototype.init = function (app) {
    this.app = app;
  };

  PagePreviewPlugin.prototype.onEnable = async function (app, plugin) {
    this.app = app;
    plugin.registerEvent(app.workspace.on("hover-link", (payload) => this.onHoverLink(payload), this));
    const data = await plugin.loadData();
    this.overrides = data && typeof data === "object" ? Object.assign({}, data) : {};
    plugin.addSettingTab(new (ng38PPTabClass(host))(app, plugin, this));
    const unfolded = app.loadLocalStorage("page-preview-unfold-properties");
    host.EmbedFileView.collapseProperties = !unfolded;
  };

  PagePreviewPlugin.prototype.requireModifier = function (source) {
    if (Object.prototype.hasOwnProperty.call(this.overrides, source)) return this.overrides[source];
    const src = this.app.workspace.hoverLinkSources && this.app.workspace.hoverLinkSources[source];
    return src ? src.defaultMod : true;
  };

  // Arms the "press Mod to preview" session on event.doc; any disarm path removes
  // all five listeners and cancels the pending expiry timer (idempotent).
  PagePreviewPlugin.prototype.armModifierPreview = function (payload) {
    const { event, hoverParent, targetEl, linktext, sourcePath, state } = payload;
    const doc = event.doc;
    if (!targetEl || !doc || !doc.addEventListener) return;
    let done = false;
    let timer = 0;
    const win = () => doc.defaultView || (typeof window !== "undefined" ? window : null);
    const disarm = () => {
      if (done) return;
      done = true;
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("mouseover", onOver);
      doc.removeEventListener("mouseleave", onLeave);
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("click", onClick);
      const w = win();
      if (timer && w && w.clearTimeout) w.clearTimeout(timer);
      timer = 0;
    };
    const open = () => {
      disarm();
      this.onLinkHover(hoverParent, targetEl, linktext, sourcePath, state);
    };
    const onKey = (e) => {
      if (done) return;
      if (!targetEl || !doc.body || !doc.body.contains(targetEl)) return disarm();
      const key = e.key || "";
      if (key.startsWith("Arrow") || key.length === 1) return disarm();
      if (host.Keymap.isModifier(e, "Mod")) open();
    };
    const onOver = (e) => {
      if (done) return;
      const t = e.target;
      if (t !== targetEl && !(targetEl.contains && targetEl.contains(t))) disarm();
    };
    const onLeave = (e) => { if (!done && e.target === doc) disarm(); };
    const onMove = () => {
      if (done) return;
      const w = win();
      if (!w) return;
      if (timer) w.clearTimeout(timer);
      timer = w.setTimeout(disarm, 2000);
    };
    const onClick = () => disarm();
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("mouseover", onOver);
    doc.addEventListener("mouseleave", onLeave);
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("click", onClick);
  };

  PagePreviewPlugin.prototype.onHoverLink = function (payload) {
    const event = payload.event;
    if (host.isTouchSyntheticMouse(event)) return;
    const rel = event.relatedTarget;
    if (rel instanceof HTMLElement && typeof rel.isShown === "function" && !rel.isShown()) return;
    const requireMod = this.requireModifier(payload.source);
    ng12PublishHoverMove(event);
    if (requireMod && !host.Keymap.isModifier(event, "Mod")) {
      this.armModifierPreview(payload);
      return;
    }
    this.onLinkHover(payload.hoverParent, payload.targetEl, payload.linktext,
      payload.sourcePath === undefined ? "" : payload.sourcePath, payload.state);
  };

  PagePreviewPlugin.prototype.onLinkHover = async function (hoverParent, targetEl, linktext, sourcePath, state) {
    const existing = hoverParent && hoverParent.hoverPopover;
    if (existing && existing.state !== host.PopoverState.Hidden && targetEl && existing.targetEl === targetEl) return;
    const popover = await host.HoverPopover.create({
      app: this.app, hoverParent, targetEl, linktext, sourcePath, state,
    });
    if (popover && typeof popover.register === "function") {
      popover.register(() => {
        this.app.saveLocalStorage("page-preview-unfold-properties", !host.EmbedFileView.collapseProperties);
      });
    }
  };

  return PagePreviewPlugin;
}

// Test-facing aliases for the legacy module contract.
export { ng38PagePreviewPlugin as definePagePreviewPlugin, ng38PagePreviewSettingTab as definePagePreviewSettingTab };
