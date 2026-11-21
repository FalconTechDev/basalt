// g34 clean-room: search/sort constants, noop matchers, blank singletons,
// embed URL detection + iframe bridge (spec g34 part G).
import { env } from "./env.js";

export const ng34SearchFields = ["filename", "filepath", "content", "propertyName", "tag"];
export const ng34DefaultSortField = "filepath";

export const ng34SortModePairs = [
  ["alphabetical", "alphabeticalReverse"],
  ["byModifiedTime", "byModifiedTimeReverse"],
  ["byCreatedTime", "byCreatedTimeReverse"],
];

const NG34_SORT_LABEL_KEYS = {
  alphabetical: "labelSortAToZ",
  alphabeticalReverse: "labelSortZToA",
  byModifiedTime: "labelSortNewToOld",
  byModifiedTimeReverse: "labelSortOldToNew",
  byCreatedTime: "labelSortCreatedNewToOld",
  byCreatedTimeReverse: "labelSortCreatedOldToNew",
};

export function ng34SortLabels() {
  const labels = env().gm.plugins.fileExplorer;
  const out = {};
  for (const mode of Object.keys(NG34_SORT_LABEL_KEYS)) {
    const label = labels[NG34_SORT_LABEL_KEYS[mode]];
    out[mode] = typeof label === "function" ? label() : label;
  }
  return out;
}

const NG34_SORT_FORWARD = {
  alphabetical: (a, b) => env().ub(a.basename, b.basename),
  byModifiedTime: (a, b) => b.stat.mtime - a.stat.mtime,
  byCreatedTime: (a, b) => b.stat.ctime - a.stat.ctime,
};

export function ng34SortComparators() {
  const out = {};
  for (const mode of Object.keys(NG34_SORT_FORWARD)) {
    const forward = NG34_SORT_FORWARD[mode];
    out[mode] = forward;
    out[mode + "Reverse"] = (a, b) => -forward(a, b);
  }
  return out;
}

export const ng34ParagraphBreak = /\r?\n\r?\n/y;

// Shared mutable render flags; inherited code flips these off for bots.
export const ng34RenderFlags = { progressiveRender: true, asyncParse: true, listBullet: true };

// Three deliberately distinct empty objects plus the null singleton.
export const ng34BlankObjectA = {};
export const ng34BlankObjectB = {};
export const ng34BlankObjectC = {};
export const ng34Nothing = null;

export function ng34NoopMatcher() {}
export function ng34NewNoopMatcher() {
  return new ng34NoopMatcher();
}

// Windows already bridged by ng34InstallFrameBridge.
export const ng34FrameBridgeSeen = new WeakSet();

// Relays iframe postMessage events as "framemessage" CustomEvents on the
// matching frame element; idempotent per window.
export function ng34InstallFrameBridge(win) {
  if (ng34FrameBridgeSeen.has(win)) return;
  ng34FrameBridgeSeen.add(win);
  win.addEventListener("message", (event) => {
    const frames = win.document.body.findAll("iframe");
    for (const frame of frames) {
      if (frame.contentWindow === event.source) {
        frame.dispatchEvent(new CustomEvent("framemessage", { bubbles: false, detail: event }));
        return;
      }
    }
  });
}

export const ng34YoutubeUrl = /(?:^|\/\/)(?:[\w-]+\.)*(?:youtube\.com\/(?:watch\?[^\s]*?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]+)(?:[^\s]*?[?&](?:t|start)=(\d+))?/i;
export const ng34TweetUrl = /(?:^|\/\/)(?:[\w-]+\.)*(?:twitter\.com|x\.com)\/(?:[\w-]+\/)*status\/(\d+)/i;

function ng34ThemeDark() {
  const body = document.body;
  return body.hasClass ? body.hasClass("theme-dark") : body.classList.contains("theme-dark");
}

// Normalises supported external URLs to privacy-friendly embed URLs.
export function ng34NormalizeEmbedUrl(url) {
  if (typeof url !== "string" || url === "") return null;
  const yt = url.match(ng34YoutubeUrl);
  if (yt) {
    return "https://www.youtube-nocookie.com/embed/" + yt[1] + (yt[2] ? "?start=" + yt[2] : "");
  }
  const tw = url.match(ng34TweetUrl);
  if (tw) {
    return "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=" + (ng34ThemeDark() ? "dark" : "light") + "&id=" + tw[1];
  }
  return null;
}

const NG34_FRAME_ATTRS = [
  ["sandbox", "allow-forms allow-presentation allow-same-origin allow-popups-to-escape-sandbox allow-scripts allow-modals allow-popups"],
  ["allow", "fullscreen"],
  ["frameborder", "0"],
  ["referrerpolicy", "strict-origin-when-cross-origin"],
];

// Builds a sandboxed embed iframe; twitter embeds get a resize bridge.
export function ng34CreateEmbedFrame(src) {
  const frame = env().createEl("iframe", "external-embed mod-receives-events");
  for (const [name, value] of NG34_FRAME_ATTRS) frame.setAttribute(name, value);
  frame.src = src;
  if (src.indexOf("platform.twitter.com") >= 0) {
    frame.setAttribute("scrolling", "no");
    frame.addEventListener("framemessage", (event) => {
      const data = event.detail && event.detail.data && event.detail.data["twttr.embed"];
      if (!data || data.method !== "twttr.private.resize") return;
      const height = data.params && data.params[0] && data.params[0].height;
      if (typeof height === "number") frame.style.height = Math.min(1000, height) + "px";
    });
    ng34InstallFrameBridge(frame.win);
    frame.onWindowMigrated(() => ng34InstallFrameBridge(frame.win));
  }
  return frame;
}
