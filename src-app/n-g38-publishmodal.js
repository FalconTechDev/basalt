// g38 clean-room: publish "Review changes" modal (spec g38 Part 5).
// Hosts eleven lazily-resolved section classes, the error banner, the loader,
// section switching, and the publish API calls for site/share deletion.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

// [instanceField, envName] — section classes resolved lazily at construction.
const ng38PubSections = [
  ["offlineSection", "U7"],
  ["noAccountSection", "W7"],
  ["manageSitesSection", "_7"],
  ["siteOptionsSection", "G7"],
  ["siteFiltersSection", "K7"],
  ["reviewChangesSection", "J7"],
  ["uploadProgressSection", "e9"],
  ["editSiteSlugSection", "t9"],
  ["listPasswordSection", "n9"],
  ["addPasswordSection", "i9"],
  ["configureCustomDomainSection", "r9"],
];

function ng38PubShowEl(el) { if (el && typeof el.show === "function") el.show(); else if (el) el.style.display = ""; }
function ng38PubHideEl(el) { if (el && typeof el.hide === "function") el.hide(); else if (el) el.style.display = "none"; }
function ng38PubSetTitle(el, text) { if (el && typeof el.setText === "function") el.setText(text); else if (el) el.textContent = text; }

export function ng38PublishChangesModal(host) {
  function PublishChangesModal(app, plugin) {
    const self = host.Modal.call(this, app) || this;
    self.plugin = plugin;
    self.modalEl.classList.add("mod-publish", "mod-lg", "mod-scrollable-content");
    ng38PubSetTitle(self.titleEl, host.i18n.plugins.publish.actionPublishChanges());
    const doc = self.contentEl.ownerDocument || document;
    for (const [field, name] of ng38PubSections) {
      self[field] = new (env()[name])(self);
    }
    const mc = doc.createElement("div");
    mc.className = "message-container";
    self.contentEl.appendChild(mc);
    self.errorMessageEl = doc.createElement("div");
    self.errorMessageEl.className = "message mod-error";
    self.errorMessageEl.style.display = "none";
    mc.appendChild(self.errorMessageEl);
    self.loaderEl = env().dD(self.contentEl);
    ng38PubHideEl(self.loaderEl);
    self.currentSection = null;
    self.autoLoadSection = null;
    return self;
  }
  inherit(PublishChangesModal, host.Modal);

  PublishChangesModal.prototype.handleError = function (error) {
    console.error(error);
    ng38PubHideEl(this.loaderEl);
    const i18n = host.i18n.plugins.publish;
    if (error instanceof env().p9) {
      if (error.code === "AUTHFAIL") {
        this.openSection(this.manageSitesSection);
        this.showError(i18n.msgNoPermissionToPublishToSite());
      } else if (error.code === "NET") {
        this.showError(i18n.msgNetworkError() + error.message);
      } else {
        this.showError(error.message);
      }
    } else {
      this.showError(i18n.msgSomethingWentWrong() + " " + (error.message || error.toString()));
    }
  };

  PublishChangesModal.prototype.showError = function (message) {
    this.errorMessageEl.textContent = message;
    ng38PubShowEl(this.errorMessageEl);
  };

  PublishChangesModal.prototype.hideError = function () {
    ng38PubHideEl(this.errorMessageEl);
  };

  PublishChangesModal.prototype.onOpen = async function () {
    if (host.Modal.prototype.onOpen) host.Modal.prototype.onOpen.call(this);
    this.closeSection();
    ng38PubShowEl(this.loaderEl);
    if (!env().Hw.token) {
      try {
        await env().Sw(env().Hw);
      } catch (e) {
        ng38PubHideEl(this.loaderEl);
        if (e && e.message === "Not logged in") await this.openSection(this.noAccountSection);
        else await this.openSection(this.offlineSection);
        return;
      }
    }
    if (this.plugin.siteId) {
      let section = this.autoLoadSection;
      this.autoLoadSection = null;
      if (typeof section === "function") section = section();
      if (section) await this.openSection(section);
      else await this.openReviewChanges();
    } else {
      await this.openSection(this.manageSitesSection);
    }
  };

  PublishChangesModal.prototype.onClose = function () {};

  PublishChangesModal.prototype.autoLoad = function (section) {
    this.autoLoadSection = section;
    return this;
  };

  PublishChangesModal.prototype.deleteSite = async function (siteId) {
    await env().Nw(env().Hw.token, siteId);
    if (this.plugin.siteId === siteId) await this.plugin.setup(null, null);
    await this.openSection(this.manageSitesSection);
  };

  PublishChangesModal.prototype.deleteSiteShare = async function (siteId, shareId) {
    await env().Bw(env().Hw.token, siteId, shareId);
    if (this.plugin.siteId === siteId) await this.plugin.setup(null, null);
    await this.openSection(this.manageSitesSection);
  };

  PublishChangesModal.prototype.acceptSiteShare = async function (siteId, code) {
    await env().gw("/publish/share/accept", { token: env().Hw.token, code });
    if (this.plugin.siteId === siteId) await this.plugin.setup(null, null);
    await this.openSection(this.manageSitesSection);
  };

  PublishChangesModal.prototype.openReviewChanges = function () {
    return this.openSection(this.reviewChangesSection);
  };

  PublishChangesModal.prototype.openManageSites = function () {
    return this.openSection(this.manageSitesSection);
  };

  PublishChangesModal.prototype.editSlug = async function (site, slug) {
    this.editSiteSlugSection.setSiteInfo(site);
    this.editSiteSlugSection.setExistingSlug(slug);
    await this.openSection(this.editSiteSlugSection);
  };

  PublishChangesModal.prototype.uploadChanges = async function (changes) {
    this.uploadProgressSection.addChanges(changes);
    await this.openSection(this.uploadProgressSection);
  };

  PublishChangesModal.prototype.showPasswords = async function () {
    const section = this.listPasswordSection;
    if (this.currentSection) this.currentSection.hide();
    ng38PubShowEl(this.loaderEl);
    try {
      const passwords = (await this.plugin.apiGetPassword()).pass;
      section.setPasswords(passwords);
      section.updateDisplay();
      await this.openSection(section);
    } catch (e) {
      this.handleError(e);
    }
  };

  PublishChangesModal.prototype.openAddPassword = function () {
    return this.openSection(this.addPasswordSection);
  };

  PublishChangesModal.prototype.setTitleText = function (text) {
    ng38PubSetTitle(this.titleEl, text);
  };

  PublishChangesModal.prototype.closeSection = function () {
    this.hideError();
    if (this.currentSection) {
      this.currentSection.hide();
      this.currentSection = null;
    }
  };

  PublishChangesModal.prototype.openSection = async function (section) {
    this.closeSection();
    if (section.title) this.setTitleText(section.title);
    this.currentSection = section;
    ng38PubShowEl(this.loaderEl);
    await section.show();
    ng38PubHideEl(this.loaderEl);
  };

  return PublishChangesModal;
}

// Test-facing alias for the legacy module contract.
export { ng38PublishChangesModal as s35PublishChangesModal };
