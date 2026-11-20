// g33 clean-room: the settings modal — phone-style two-pane layout with a
// vertical tab strip, plugin tab groups and swipe-to-go-back on phones.
// Replaces orig vte (class).
import { runTransition } from "./animation.js";
import { inherit } from "./inherit.js";

const NG33S_TAB_DEFS = [
  ["s16TabAbout", "about"],
  ["s16TabEditor", "editor"],
  ["s16MobileTab", "mobile", true],
  ["s16TabFiles", "files"],
  ["s16TabAppearance", "appearance"],
  ["s16TabHotkeys", "hotkeys"],
  ["KeychainTab", "keychain"],
  ["s16TabPlugins", "plugins"],
  ["s16TabCommunity", "community"],
];

export function defineSettingsModal(host) {
  function SettingsModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.app = app;
    self.settingTabs = [];
    self.pluginTabs = [];
    self.activeTab = null;
    self.activeTabCloseable = null;
    self.feedbackBanner = null;
    self.lastTabId = "";

    self.modalEl.addClass("mod-settings");
    self.modalEl.addClass("mod-sidebar-layout");
    self.contentEl.addClass("vertical-tabs-container");
    self.updateModalTitle();

    self.tabHeadersEl = self.contentEl.createDiv("vertical-tab-header");
    if (host.Platform.isPhone) self.feedbackBanner = new host.s16FeedbackBanner(app, self.tabHeadersEl);

    const groups = [
      { section: "options", title: host.i18n.setting.options(), items: null },
      { section: "core-plugins", title: host.i18n.setting.builtinPlugins(), items: null, plugin: true },
      { section: "community-plugins", title: host.i18n.setting.thirdPartyPlugin.name(), items: null, plugin: true },
    ];
    self.tabHeaderGroups = [];
    for (const g of groups) {
      const groupEl = self.tabHeadersEl.createDiv("vertical-tab-header-group");
      const titleEl = groupEl.createDiv("vertical-tab-header-group-title");
      titleEl.setText(g.title);
      if (g.plugin) titleEl.hide();
      const itemsEl = groupEl.createDiv("vertical-tab-header-group-items");
      itemsEl.setAttribute("data-section", g.section);
      g.items = itemsEl;
      self.tabHeaderGroups.push({ def: g, titleEl, itemsEl });
    }
    self.tabContainer = self.tabHeaderGroups[0].itemsEl;
    self.corePluginTabContainer = self.tabHeaderGroups[1].itemsEl;
    self.communityPluginTabContainer = self.tabHeaderGroups[2].itemsEl;
    self.optionsTabHeaderGroup = self.tabHeaderGroups[0].titleEl;
    self.corePluginTabHeaderGroup = self.tabHeaderGroups[1].titleEl;
    self.communityPluginTabHeaderGroup = self.tabHeaderGroups[2].titleEl;

    self.tabContentContainer = self.contentEl.ownerDocument.createElement("div");
    self.tabContentContainer.addClass("vertical-tab-content-container");

    for (const def of NG33S_TAB_DEFS) {
      if (def[2] && !host.Platform.isMobile) continue;
      self.addSettingTab(new host[def[0]](app, self));
    }

    if (host.Platform.isPhone) self.installSwipeBack();
    return self;
  }
  inherit(SettingsModal, host.Modal);

  SettingsModal.prototype.installSwipeBack = function () {
    host.onSwipe(this.contentEl, (gesture) => {
      if (gesture.points !== 1 || gesture.direction !== "x") return;
      const tab = this.activeTab;
      if (!tab || gesture.startX > 40) return;
      const contentEl = this.contentEl;
      const headerEl = this.tabHeadersEl;
      const width = contentEl.clientWidth || 1;
      const startX = gesture.startX;
      host.saveScrollPositions(headerEl);
      contentEl.prepend(headerEl);
      const box = tab.containerEl;
      gesture.registerCallback({
        move(_event, x) {
          const ratio = Math.min(Math.max((x - startX) / width, 0), 1);
          box.style.transform = `translateX(${ratio * width}px)`;
        },
        cancel() {
          box.style.transform = "";
          headerEl.detach();
        },
        finish(_event, x, velocity) {
          const ratio = Math.min(Math.max((x - startX) / width, 0), 1);
          if (0.5 * velocity < width / 2) {
            runTransition(box, new host.Transition({ duration: 150 * ratio }).addProp("transform", null, "", ""));
            box.style.transform = "";
            headerEl.detach();
          } else {
            runTransition(
              box,
              new host.Transition({ duration: 100 * (1 - ratio), fn: "ease-out" }).addProp("transform", null, `translateX(${width}px)`, ""),
              () => {
                if (box.parentNode) box.parentNode.removeChild(box);
                this.closeActiveTab();
              }
            );
          }
        },
      });
    });
  };

  SettingsModal.prototype.updateModalTitle = function (tab) {
    this.setTitle(tab ? tab.name : host.i18n.interface.settings());
  };

  SettingsModal.prototype.isPluginSettingTab = function (tab) {
    return tab instanceof host.PluginInstanceSettingTab || tab instanceof host.PluginSettingTab;
  };

  SettingsModal.prototype.addSettingTab = function (tab) {
    if (!tab.navEl) {
      const doc = this.tabHeadersEl.ownerDocument;
      const nav = doc.createElement("div");
      nav.className = "vertical-tab-nav-item tappable";
      nav.setAttribute("data-setting-id", tab.id);
      if (tab.icon) {
        const icon = nav.createDiv("vertical-tab-nav-item-icon");
        host.setIcon(icon, tab.icon);
      }
      nav.createDiv("vertical-tab-nav-item-title").setText(tab.name);
      const chevron = nav.createDiv("vertical-tab-nav-item-chevron");
      host.setIcon(chevron, "lucide-chevron-right");
      nav.addEventListener("click", () => this.openTab(tab));
      tab.navEl = nav;
    }
    if (this.isPluginSettingTab(tab)) this.pluginTabs.push(tab);
    else {
      this.settingTabs.push(tab);
      this.tabContainer.appendChild(tab.navEl);
    }
    this.updatePluginSection();
  };

  SettingsModal.prototype.removeSettingTab = function (tab) {
    let i = this.settingTabs.indexOf(tab);
    if (i >= 0) this.settingTabs.splice(i, 1);
    i = this.pluginTabs.indexOf(tab);
    if (i >= 0) this.pluginTabs.splice(i, 1);
    if (this.activeTab === tab) this.closeActiveTab();
    if (tab.navEl && tab.navEl.parentNode) tab.navEl.parentNode.removeChild(tab.navEl);
    this.updatePluginSection();
  };

  SettingsModal.prototype.updatePluginSection = function () {
    const byName = (a, b) => host.compareStrings(a.name, b.name);
    const isCore = (t) => t instanceof host.PluginInstanceSettingTab;
    const isCom = (t) => t instanceof host.PluginSettingTab && !isCore(t);
    const core = this.pluginTabs.filter(isCore).sort(byName);
    const com = this.pluginTabs.filter(isCom).sort(byName);
    const fill = (container, titleEl, tabs) => {
      container.empty();
      for (const t of tabs) container.appendChild(t.navEl);
      if (tabs.length) titleEl.show();
      else titleEl.hide();
    };
    fill(this.corePluginTabContainer, this.corePluginTabHeaderGroup, core);
    fill(this.communityPluginTabContainer, this.communityPluginTabHeaderGroup, com);
  };

  SettingsModal.prototype.openTab = function (tab) {
    const prev = this.activeTab;
    this.tabContentContainer.empty();
    if (this.activeTabCloseable) {
      host.unregisterOpenModal(this.activeTabCloseable);
      this.activeTabCloseable = null;
    }
    this.updateModalTitle(tab);
    if (prev) {
      prev.navEl.removeClass("is-active");
      prev.hide();
    }
    this.activeTab = tab;
    this.lastTabId = tab.id;
    tab.navEl.addClass("is-active");
    this.activeTabCloseable = { close: () => this.closeActiveTab() };
    host.registerOpenModal(this.activeTabCloseable);
    this.tabContentContainer.appendChild(tab.containerEl);

    const doc = this.titleEl.ownerDocument;
    const back = doc.createElement("div");
    back.className = "clickable-icon modal-setting-back-button mod-raised";
    host.setIcon(back, "lucide-arrow-left");
    back.addEventListener("click", () => this.closeActiveTab());
    this.titleEl.prepend(back);

    if (host.Platform.isPhone && !prev) {
      host.saveScrollPositions(this.tabHeadersEl);
      host.s16SlidePanes(this.contentEl, this.tabContentContainer, "right");
    } else {
      this.contentEl.appendChild(this.tabContentContainer);
    }
    tab.display();
  };

  SettingsModal.prototype.closeActiveTab = function () {
    const tab = this.activeTab;
    if (!tab) return;
    this.tabContentContainer.empty();
    tab.navEl.removeClass("is-active");
    tab.hide();
    this.updateModalTitle();
    if (this.activeTabCloseable) {
      host.unregisterOpenModal(this.activeTabCloseable);
      this.activeTabCloseable = null;
    }
    const shown = (el) => (el.isShown ? el.isShown() : el.style.display !== "none");
    const finish = () => {};
    if (host.Platform.isPhone && shown(this.contentEl) && shown(this.tabContentContainer)) {
      host.s16SlidePanes(this.contentEl, this.tabHeadersEl, "left", finish);
    } else {
      this.contentEl.setChildrenInPlace([this.tabHeadersEl]);
      finish();
    }
    host.restoreScrollPositions(this.tabHeadersEl);
    this.activeTab = null;
  };

  SettingsModal.prototype.openTabById = function (id) {
    for (const tab of this.settingTabs) {
      if (tab.id === id) {
        this.openTab(tab);
        return tab;
      }
    }
    for (const tab of this.pluginTabs) {
      if (tab.id === id) {
        this.openTab(tab);
        return tab;
      }
    }
    return null;
  };

  SettingsModal.prototype.onOpen = function () {
    host.Modal.prototype.onOpen.call(this);
    if (host.Platform.isPhone) {
      if (this.feedbackBanner) this.feedbackBanner.show();
      return;
    }
    const tab = this.lastTabId ? this.openTabById(this.lastTabId) : null;
    if (!tab && this.settingTabs.length) this.openTab(this.settingTabs[0]);
  };

  SettingsModal.prototype.onClose = function () {
    host.Modal.prototype.onClose.call(this);
    this.closeActiveTab();
  };

  SettingsModal.prototype.animateOpen = async function () {};
  SettingsModal.prototype.animateClose = async function () {};

  return SettingsModal;
}
