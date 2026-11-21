// g36 clean-room: community-plugin trust prompt + small declarators (spec g36
// Part E). i18n subtrees are looked up per call so locale changes are seen.

import { env } from "./env.js";
import { inherit } from "./inherit.js";

export function ng36ThirdPartyPluginI18n() {
  return env().gm.setting.thirdPartyPlugin;
}

const NG36_DEPRECATION_REPO = "obsidianmd/obsidian-releases";
const NG36_DEPRECATION_FILE = "community-plugin-deprecation.json";

/** Raw-file URL of the community-plugin deprecation manifest. */
export function ng36DeprecationManifestUrl(ty) {
  const build = ty || env().s12githubRaw;
  return build(NG36_DEPRECATION_REPO, NG36_DEPRECATION_FILE);
}

/** Mutable holder for the fetched deprecation manifest (reassigned at runtime). */
export let ng36DeprecationManifestData = {};

const NG36_SORT_LABEL_KEYS = Object.freeze({
  download: "labelByPopularity",
  release: "labelByReleased",
  alphabetical: "labelAlphabetical",
  update: "labelByUpdated",
});

export function ng36PluginSortLabels() {
  const t = env().gm.setting.thirdPartyPlugin;
  const out = {};
  for (const key of Object.keys(NG36_SORT_LABEL_KEYS)) out[key] = t[NG36_SORT_LABEL_KEYS[key]];
  return out;
}

// ---------------------------------------------------------------------------
// Tree drag drop indicator
// ---------------------------------------------------------------------------

let ng36DropIndicator = null;

/** The shared drop-indicator element (created once). */
export function ng36DropIndicatorEl() {
  if (!ng36DropIndicator) ng36DropIndicator = env().createDiv("drop-indicator is-active");
  return ng36DropIndicator;
}

/**
 * Debounced position updater for the drop indicator: `after` placements sit
 * 1px lower, everything else 3px higher relative to the pointer y.
 */
export function ng36PositionDropIndicator(el, debounceFn) {
  const debounce = debounceFn || env().debounce;
  return debounce((info) => {
    el.style.left = info.x + "px";
    el.style.top = (info.y + (info.placement === "after" ? 1 : -1) - 2) + "px";
  }, 0);
}

// ---------------------------------------------------------------------------
// Trust-author modal
// ---------------------------------------------------------------------------

export function ng36TrustFolderModal(host) {
  function TrustFolderModal(app) {
    const self = host.DialogModal.call(this, app) || this;
    self.modalEl.classList.add("mod-lg");
    self.modalEl.classList.add("mod-trust-folder");
    const t = env().gm.setting.thirdPartyPlugin;
    self.setTitle(t.labelTrustAuthor());
    for (const key of ["labelTrustAuthorDescription_1", "labelTrustAuthorDescription_2", "labelTrustAuthorDescription_3"]) {
      self.contentEl.appendChild(document.createElement("p")).textContent = t[key]();
    }
    const openSettings = async (enabled) => {
      self.close();
      await app.plugins.setEnable(enabled);
      app.setting.open();
      app.setting.openTabById("community-plugins");
    };
    const mk = (key, fn) => {
      const btn = document.createElement("button");
      btn.textContent = t[key]();
      btn.onclick = fn;
      self.buttonContainerEl.appendChild(btn);
      return btn;
    };
    mk("buttonEnablePlugins", () => openSettings(true));
    mk("buttonDontTrustAuthor", () => openSettings(false));
    return self;
  }
  inherit(TrustFolderModal, host.DialogModal);
  return TrustFolderModal;
}
