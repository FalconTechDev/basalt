// g36 clean-room: the "release-notes" ItemView (spec g36 Part A). Fetches the
// running minor series' notes markdown from the docs repo, renders the current
// patch callout plus lazily-collapsible callouts for earlier patches, and
// round-trips `currentVersion` through view state.

import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parseVersion } from "./text.js";
import { frontmatterBounds } from "./n-g13-notes.js";
import { ng36ReleaseNotesRepo, ng36ReleaseNotesViewType } from "./n-g36-support.js";

const NG36_VERSION_RE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

function ng36ReleaseI18n(host) { return host.i18n.interface.releaseNotes; }

function ng36Moment() { return (typeof window !== "undefined" && window.moment) || null; }

/** Builds one collapsible callout; `onActivate(contentEl)` fills it lazily. */
function ng36PatchCallout(host, opts) {
  const callout = createDiv("callout is-collapsed is-collapsible");
  callout.setAttribute("data-callout", opts.type || "");
  const titleEl = createDiv("callout-title");
  const innerEl = createDiv("callout-title-inner");
  innerEl.textContent = opts.title;
  const fold = createDiv("callout-fold");
  fold.classList.add("is-collapsed");
  host.setIcon(fold, "lucide-chevron-down");
  titleEl.appendChild(innerEl);
  titleEl.appendChild(fold);
  callout.appendChild(titleEl);
  const content = createDiv("callout-content");
  content.style.display = "none";
  if (opts.inner && opts.inner.length) content.append(...opts.inner);
  callout.appendChild(content);
  titleEl.addEventListener("mousedown", (e) => e.preventDefault());
  titleEl.addEventListener("click", () => {
    const wasCollapsed = callout.classList.contains("is-collapsed");
    callout.classList.toggle("is-collapsed", !wasCollapsed);
    fold.classList.toggle("is-collapsed", !wasCollapsed);
    host.collapseElement(content, !wasCollapsed);
    if (opts.onActivate) opts.onActivate(content);
  });
  return callout;
}

export function ng36ReleaseNotesView(host) {
  function ReleaseNotesView(app) {
    const self = host.ItemView.call(this, app) || this;
    self.canDropAnywhere = true;
    self.navigation = true;
    self.version = "";
    self.contentEl.addClass("release-notes-view");
    return self;
  }
  inherit(ReleaseNotesView, host.ItemView);
  const proto = ReleaseNotesView.prototype;

  proto.getViewType = function () { return ng36ReleaseNotesViewType; };
  proto.getIcon = function () { return "lucide-book-up"; };
  proto.getDisplayText = function () { return ng36ReleaseI18n(host).tabTitle({ version: this.version }); };

  proto.getState = function (eState) {
    const base = host.ItemView.prototype.getState;
    const state = (base ? base.call(this, eState) : {}) || {};
    state.currentVersion = this.version;
    return state;
  };

  proto.setState = async function (state, eState) {
    const base = host.ItemView.prototype.setState;
    if (base) await base.call(this, state, eState);
    const stored = state && typeof state.currentVersion === "string" && NG36_VERSION_RE.test(state.currentVersion)
      ? state.currentVersion : null;
    const next = stored || this.version || env().gte;
    if (next !== this.version) {
      this.version = next;
      await this.render();
    }
  };

  /** Markdown for `Release notes/v<version>.md`; localized failure strings on error. */
  proto.fetchReleaseNotes = async function (version) {
    const i18n = ng36ReleaseI18n(host);
    try {
      const res = env().s04Request({ url: env().s04RawFileUrl(ng36ReleaseNotesRepo, "Release%20notes/v" + version + ".md"), throw: true });
      return await res.text;
    } catch (err) {
      if (err && err.status === 404) return i18n.msgMissingReleaseNotes({ version });
      return i18n.msgFailedToLoad({ version });
    }
  };

  /** Renders one version's notes into `container` (date line + markdown body). */
  proto.renderReleaseDoc = function (container, text) {
    const bounds = frontmatterBounds(text);
    let fm = {};
    if (bounds.exists) {
      try { fm = host.parseYaml(bounds.frontmatter) || {}; } catch (e) { fm = {}; }
    }
    const body = text.slice(bounds.contentStart);
    if (typeof fm.date === "string" && fm.date) {
      const moment = ng36Moment();
      const formatted = moment ? moment(fm.date).format("MMMM D, YYYY") : fm.date;
      const p = document.createElement("p");
      p.className = "u-small";
      p.textContent = ng36ReleaseI18n(host).msgReleaseDate({ date: formatted });
      container.appendChild(p);
    }
    let html = "";
    try {
      html = host.sanitizeHtml(host.treeToHtml(host.markdownTree(body)));
    } catch (e) { html = ""; }
    if (html) {
      const wrap = document.createElement("div");
      wrap.innerHTML = html;
      container.appendChild(wrap);
    }
  };

  /** Lazy loader behind a patch callout: fetch once, then render into content. */
  proto.showPatchNotes = async function (container, version) {
    if (container.hasChildNodes && container.hasChildNodes()) return;
    await env().Uv(container, async () => {
      const text = await this.fetchReleaseNotes(version);
      this.renderReleaseDoc(container, text);
    });
  };

  proto.render = async function () {
    const self = this;
    const contentEl = this.contentEl;
    contentEl.empty();
    const scroller = contentEl.createDiv("cm-scroller");
    const readable = this.app.vault.getConfig && this.app.vault.getConfig("readableLineLength");
    scroller.toggleClass("is-readable-line-width", !!readable);
    const preview = scroller.createDiv("markdown-preview-view markdown-rendered");
    const parts = parseVersion(this.version);
    if (!parts || !parts.length) return;
    const series = parts.slice(0, -1);
    const last = parts[parts.length - 1];
    const i18n = ng36ReleaseI18n(host);
    if (last > 0) {
      preview.appendChild(ng36PatchCallout(host, {
        type: "attention",
        title: i18n.labelRelease({ version: this.version }),
        onActivate: (content) => self.showPatchNotes(content, self.version),
      }));
    }
    if (last > 1) {
      const inner = [];
      for (let n = last - 1; n >= 0; n--) {
        const v = series.concat([n]).join(".");
        inner.push(ng36PatchCallout(host, {
          type: "info",
          title: i18n.labelRelease({ version: v }),
          onActivate: (content) => self.showPatchNotes(content, v),
        }));
      }
      preview.appendChild(ng36PatchCallout(host, { type: "", title: "Other versions", inner }));
    }
    preview.appendChild(document.createElement("hr"));
    preview.appendChild(document.createElement("h1")).textContent = i18n.labelRelease({ version: series.join(".") });
    const text = await this.fetchReleaseNotes(series.join("."));
    this.renderReleaseDoc(preview, text);
    env().eb(preview, ng36ReleaseNotesRepo);
    const section = document.createElement("section");
    section.className = "footnotes";
    section.appendChild(document.createElement("hr"));
    const p = document.createElement("p");
    p.className = "footnote";
    p.append("A complete list of previous changes can be found on ");
    const a = document.createElement("a");
    a.className = "external-link";
    a.setAttribute("href", "https://github.com/FalconTechDev/basalt/releases");
    a.textContent = "our changelog";
    p.appendChild(a);
    p.append(".");
    section.appendChild(p);
    preview.appendChild(section);
  };

  return ReleaseNotesView;
}
