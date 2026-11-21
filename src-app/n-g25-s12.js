// n-g25-s12.js — clean-room s12-consts replacement (spec g25 Part F).
import { env } from "./env.js";

export function s12SecretsWarningKey() { return "secrets-encryption-warning-dismissed"; }
export function s12SecretsDirName() { return "secrets"; }
export function s12SecretsEncryptedName() { return "secrets-encrypted"; }
export function s12SecretsMetaName() { return "secrets-meta"; }
export function s12ReleaseNotesViewType() { return "release-notes"; }
export function s12ReleaseNotesRepo() { return "obsidianmd/obsidian-docs"; }
export function s12WorkspaceLayoutFile() { return "workspace.json"; }
export function s12WorkspaceMobileLayoutFile() { return "workspace-mobile.json"; }
export function s12WebviewerViewType() { return "webviewer"; }
export function s12WebviewerHistoryViewType() { return "webviewer-history"; }
export function s12DefaultSearchEngineKey() { return "duckduckgo"; }
export function s12WebviewerEmptyPageUrl() { return "data:text/plain,"; }
export function s12BacklinkViewType() { return "backlink"; }
export function s12MarkdownViewTypeName() { return "markdown"; }
export function s12DeprecationIndexUrl() {
  return env().s12githubRaw("obsidianmd/obsidian-releases", "community-plugin-deprecation.json");
}

export function s12CmIterateErrorDetail() {
  return "tree.iterate has changed syntax. Migrate to the object form tree.iterate({from,to,enter,leave}); see https://discuss.codemirror.net/t/tree-iterate/ for details.";
}

export function s12CmIterateCompat(inner) {
  return function (spec, from, to) {
    console.error(new Error("[CM6] " + s12CmIterateErrorDetail()));
    return inner.call(this, spec && spec.type !== undefined ? spec.type : spec, spec && spec.from !== undefined ? spec.from : from, spec && spec.to !== undefined ? spec.to : to);
  };
}

export function s12CmEmptyFieldConfig() { return { from() {} }; }

const S12REQ_SPEC = [
  ["obsidian", "s12reqObsidian"],
  ["@codemirror/autocomplete", "s12reqAutocomplete"],
  ["@codemirror/collab", "s12reqCollab"],
  ["@codemirror/commands", "s12reqCommands"],
  ["@codemirror/language", "s12reqLanguage"],
  ["@codemirror/lint", "s12reqLint"],
  ["@codemirror/search", "s12reqSearch"],
  ["@codemirror/state", "s12reqState"],
  ["@codemirror/text", "s12reqState"],
  ["@codemirror/view", "s12reqView"],
  ["@lezer/common", "s12reqLezerCommon"],
  ["@lezer/lr", "s12reqLezerLr"],
  ["@lezer/highlight", "s12reqLezerHighlight"],
];

export function s12PluginRequireMap() {
  const out = {};
  const e = env();
  for (const [name, key] of S12REQ_SPEC) out[name] = e[key];
  return out;
}

const S12REQ_DEPRECATED = {
  "@codemirror/closebrackets": "@codemirror/autocomplete",
  "@codemirror/comment": "@codemirror/commands",
  "@codemirror/fold": "@codemirror/language",
  "@codemirror/gutter": "@codemirror/view",
  "@codemirror/highlight": "@codemirror/language",
  "@codemirror/history": "@codemirror/commands",
  "@codemirror/matchbrackets": "@codemirror/language",
  "@codemirror/panel": "@codemirror/view",
  "@codemirror/rangeset": "@codemirror/state",
  "@codemirror/rectangular-selection": "@codemirror/view",
  "@codemirror/stream-parser": "@codemirror/language",
  "@codemirror/tooltip": "@codemirror/view",
};

export function s12PluginDeprecatedRequireMap() {
  const req = s12PluginRequireMap();
  const out = {};
  for (const [dep, cur] of Object.entries(S12REQ_DEPRECATED)) out[dep] = req[cur];
  return out;
}

export function s12InlineSourcemapPattern() {
  return /^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gm;
}
export function s12NoSourcemapMarker() { return "\n/* nosourcemap */"; }

export function s12WebviewerSearchEngines() {
  return {
    duckduckgo: { display: "duckduckgo", url: "https://duckduckgo.com/?q=%s" },
    brave: { display: "brave", url: "https://search.brave.com/search?q=%s" },
    bing: { display: "bing", url: "https://www.bing.com/search?q=%s" },
    google: { display: "google", url: "https://www.google.com/search?q=%s" },
    custom: { display: "custom" },
  };
}
export function s12WebviewerDefaultOptions() { return { openExternalURLs: true, enableAdblocking: true }; }
export function s12EmptyWebviewerOptions() { return {}; }
export function s12WebviewTagBlocklist() { return ["script", "style", "link", "meta", "object", "embed", "webview"]; }
export function s12NullDropState() { return null; }

let ng25s12DropEl = null;
export function s12DropIndicatorElement() {
  if (!ng25s12DropEl) ng25s12DropEl = env().createDiv("drop-indicator is-active");
  return ng25s12DropEl;
}
export function s12DropIndicatorUpdater() {
  const el = s12DropIndicatorElement();
  return env().debounce(({ x, y, placement }) => {
    el.style.left = x + "px";
    el.style.top = (y + (placement === "after" ? 1 : -1) - 2) + "px";
  }, 0);
}

const S12CALLOUT_KEYS = ["info", "important", "tip", "success", "question", "warning", "example", "quote"];
export function s12CalloutTypeLabels() {
  const t = env().gm.callout.type;
  const out = {};
  for (const k of S12CALLOUT_KEYS) out[k] = t[k];
  return out;
}
const S12CALLOUT_EXTRA = ["abstract", "summary", "tldr", "todo", "hint", "check", "done", "question", "faq", "help", "caution", "attention", "failure", "fail", "missing", "danger", "error", "bug", "example", "cite"];
export function s12CalloutTypeNames() { return S12CALLOUT_KEYS.concat(S12CALLOUT_EXTRA); }

export function s12PluginSortLabels() {
  const s = env().gm.setting.thirdPartyPlugin;
  return {
    download: s.labelByPopularity,
    release: s.labelByReleased,
    alphabetical: s.labelAlphabetical,
    update: s.labelByUpdated,
  };
}
export function s12HotkeyFilterLabels() {
  const h = env().gm.setting.hotkeys;
  return {
    "show-all": h.labelShowAll,
    "show-assigned": h.labelShowAssigned,
    "show-user-assigned": h.labelShowUserAssigned,
    "show-unassigned": h.labelShowUnassigned,
  };
}

let ng25s12PostFx = null;
export function s12CmPostprocessEffect() {
  if (!ng25s12PostFx) ng25s12PostFx = env().s12cmStateEffect.define();
  return ng25s12PostFx;
}
export function s12cmPostprocessFxRef() { return ng25s12PostFx; }
export function s12cmRefreshDispatch(view) {
  const fx = s12CmPostprocessEffect();
  view.dom.win.setTimeout(() => view.dispatch({ effects: fx.of() }), 10);
}

let ng25s12MousePlugin = null;
export function s12CmMouseDownPlugin() {
  if (!ng25s12MousePlugin) {
    ng25s12MousePlugin = env().s12cmViewPlugin.define(() => ({ mousedown: false }));
  }
  return ng25s12MousePlugin;
}
export function s12cmMousePluginInstance() { return ng25s12MousePlugin; }
export function s12cmEmptyReplace() { return env().s12cmDecoration.replace({}); }

export function s12CmUnderlineMark() {
  return env().s12cmDecoration.mark({ class: "cm-underline", attributes: { tabindex: "-1", draggable: "true" } });
}
export function s12CmTransparentMark() { return env().s12cmDecoration.mark({ class: "cm-transparent" }); }
export function s12CmUnresolvedMark() { return env().s12cmDecoration.mark({ class: "is-unresolved" }); }
export function s12CmListBulletMark() { return env().s12cmDecoration.mark({ class: "list-bullet" }); }
export function s12CmListNumberMark() { return env().s12cmDecoration.mark({ class: "list-number" }); }
export function s12CmMouseDownField() { return env().s12cmStateField.define(() => ({ mousedown: false })); }

export function s12LivepreviewSyntaxTags() {
  return new Set(["em", "strong", "inline-code", "strikethrough", "highlight", "link", "image", "hmd-internal-link", "hmd-embed", "formatting-link", "footref"]);
}
export function s12CodeblockFencePattern() { return /^\s*(~~~+|```+)[ \t]*([\w\/+\#-]*)[^\n`]*$/; }

export function s12RegisterSecureStorage() {
  return env().s12capacitor.F3("SecureStorage", {
    web: () => {
      const m = env().s12webpackRequire(3357);
      return m.SecureStorageWeb || m.default || m;
    },
    ios: () => {
      const m = env().s12webpackRequire(9804);
      return typeof m.SecureStorageNative === "function" ? m.SecureStorageNative(self) : (m.SecureStorageNative || m.default || m);
    },
    android: () => {
      const m = env().s12webpackRequire(9804);
      return typeof m.SecureStorageNative === "function" ? m.SecureStorageNative(self) : (m.SecureStorageNative || m.default || m);
    },
  });
}

const S12LEAF_TYPES = ["tab", "window", "split"];
export function s12leafTypeOrFalse(e) {
  const isBool = typeof isBoolean === "function" ? isBoolean(e) : typeof e === "boolean";
  if (isBool || S12LEAF_TYPES.includes(e)) return e;
  return false;
}

export function s12requireDesktopApp() {
  const e = env();
  const iface = e.gm.interface;
  if (!e.Yl.isDesktopApp) {
    const msg = iface.msgDesktopOnlyFeature();
    new e.fb(msg);
    throw new Error(msg);
  }
  if (e.qf < 13) {
    const msg = iface.msgUpgradeInstaller();
    new e.fb(msg);
    throw new Error(msg);
  }
}

export function s12runCommandCallback(cmd) {
  if (cmd.checkCallback) cmd.checkCallback(false);
  else if (cmd.callback) cmd.callback();
  else console.error("Command " + cmd + " did not provide a callback");
}

function ng25s12StripDim(s, isDim) {
  const pi = s.lastIndexOf("|");
  if (pi >= 0 && isDim(s.slice(pi + 1))) return s.slice(0, pi);
  return s;
}

export function s12appendImageSizeText(linkText, size) {
  const sized = size === undefined ? "" : String(size);
  const e = env();
  const isDim = (t) => !!e.s12isImageDimension(t);
  const fix = (inner) => {
    let s = ng25s12StripDim(inner, isDim);
    if (!s || isDim(s)) return sized;
    return s + (sized ? "|" + sized : "");
  };
  const wiki = e.s12wikilinkPattern.exec(linkText);
  if (wiki) {
    const inner = wiki[2] + (wiki[3] || "");
    return wiki[1] + fix(inner) + wiki[5];
  }
  const md = e.s12mdLinkPattern.exec(linkText);
  if (md) {
    return md[1] + fix(md[2]) + md[3] + md[4] + md[8];
  }
  return linkText;
}

export function s12PropertiesLivePreviewPlugin(plugin) {
  return env().s12cmViewPlugin.define((view) => {
    const off = plugin.app.workspace.on("post-processor-change", () => s12cmRefreshDispatch(view));
    return { destroy() { off.e.offref(off); } };
  });
}
