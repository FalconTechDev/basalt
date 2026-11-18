// g25 clean-room s05-utils: mdast text/positions, frontmatter links, filename checks,
// loaders, system info, mobile vault list, titlebar dblclick, wheel scroll.
// Spec: F:\orch\specs\g25.md Part D.

import { env } from "./env.js";
import { lastSegment, isLocalLink } from "./path.js";
import { frontmatterStrings } from "./frontmatter.js";
import { anyRefMatch } from "./metadata-helpers.js";
import { chromeVersion } from "./text.js";

// ---------------------------------------------------------------- mdast

/** mdast 1-based {line,column,offset} -> 0-based {line,col,offset}. */
export function s05Point(position) {
  return { line: position.line - 1, col: position.column - 1, offset: position.offset };
}

/** {start,end} points of an mdast range. */
export function s05Range(range) {
  return { start: s05Point(range.start), end: s05Point(range.end) };
}

export function s05HasPosition(node) {
  return !!node && Object.prototype.hasOwnProperty.call(node, "position");
}

export function s05HasKey(node) {
  return !!node && Object.prototype.hasOwnProperty.call(node, "key");
}

/** mdast subtree -> plain text (type-specific whitespace rules). */
export function s05InlineText(node) {
  if (!node) return "";
  const type = node.type;
  if (type === "html" || type === "comment") return "";
  if (type === "iembed") return node.href || "";
  if (type === "tag") return node.tag || "";
  if (type === "listItem") {
    const kids = node.children || [];
    return kids.map(s05InlineText).join("\n") + "\n";
  }
  let text = node.value || node.alt || node.title || "";
  if (!text) {
    const kids = node.children || [];
    if (kids.length) text = kids.map(s05InlineText).join("");
  }
  if (type === "list" && typeof node.start === "number") text = node.start + ". " + text;
  if (type === "paragraph" || type === "break" || type === "heading" || type === "code") {
    text += "\n";
  } else {
    text = text.replace(/\n$/, "");
  }
  if (type === "tableCell") text += " ";
  if (type === "tableRow") text += "\n";
  return text;
}

/** Plain text of each child node. */
export function s05ChildrenText(children) {
  return (children || []).map(s05InlineText);
}

// ---------------------------------------------------------------- frontmatter links

const ng25MdLinkFull = /^(!?\[)([^\]]*)\]\(\s*(<[^>]*?>|[^)\s]+)(?:\s+[^)]*)?\s*\)$/;

function ng25FmLinkValue(value) {
  const t = value.trim();
  if (t.length > 4 && t.charAt(0) === "[" && t.charAt(1) === "[") {
    const parsed = env().iE(t.slice(2, -2));
    if (parsed && parsed.href !== undefined) {
      return { link: parsed.href, original: value, displayText: parsed.title };
    }
  }
  const m = ng25MdLinkFull.exec(t);
  if (m) {
    let dest = m[3];
    if (dest.charAt(0) === "<" && dest.charAt(dest.length - 1) === ">") dest = dest.slice(1, -1);
    let link;
    try { link = decodeURI(dest); } catch { link = dest; }
    if (isLocalLink(link)) return { link, original: value, displayText: m[2] };
  }
  return null;
}

/** All "[[…]]" / "[…](…)" links inside a frontmatter object, with dotted keys. */
export function s05FrontmatterLinks(frontmatter) {
  const out = [];
  const walk = (value, key) => {
    if (typeof value === "string") {
      const link = ng25FmLinkValue(value);
      if (link) out.push({ key, link: link.link, original: link.original, displayText: link.displayText });
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], key + "." + i);
      return;
    }
    if (value && typeof value === "object") {
      for (const k of Object.keys(value)) walk(value[k], key ? key + "." + k : k);
    }
  };
  walk(frontmatter, "");
  return out;
}

/** Metadata node links or embeds match the predicate. */
export function s05HasRef(node, target) {
  if (!node) return false;
  return anyRefMatch(node.links, target) || anyRefMatch(node.embeds, target);
}

/** Plain text of a cached heading (parsed markdown, raw fallback). */
export function s05HeadingText(heading) {
  const raw = heading && heading.heading;
  try {
    const parsed = env().Kx(raw);
    const text = parsed ? s05InlineText(parsed) : "";
    return text || raw;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------- filenames

const ng25Reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Throws Error on an invalid file name (Windows rules only when env().Ul). */
export function s05AssertValidFileName(name) {
  if (env().Ul) {
    const base = lastSegment(String(name));
    if (/[. ]$/.test(base)) throw new Error("File name must not end with a dot or space: " + name);
    if (ng25Reserved.test(base)) throw new Error("Reserved file name: " + name);
  }
  const segs = String(name).split(/[\\/]/);
  const bad = env().UT;
  for (const seg of segs) {
    if (bad && bad.test(seg)) throw new Error("Invalid characters in file name (" + (env().qT || "") + "): " + name);
  }
}

export function s05IsValidFileName(name) {
  try {
    s05AssertValidFileName(name);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- misc app helpers

/** One-shot filesystem permission probe; caches the flag in env().kD. */
export async function s05CheckFilePermissions() {
  if (env().kD !== undefined && env().kD !== null) return env().kD;
  try {
    const r = await env().Dm.checkPerms();
    env().kD = r !== false;
  } catch {
    env().kD = false;
  }
  return env().kD;
}

/** Append {key, ts} to the action log env().aD. */
export function s05TrackAction(key) {
  const log = env().aD;
  if (log && typeof log.push === "function") log.push({ key, ts: performance.now() });
}

/** Dotted-path lookup inside the animation tree env().lD; null when missing. */
export function s05LookupAnimNode(path) {
  let node = env().lD;
  if (!node) return null;
  if (!path) return node;
  for (const seg of String(path).split(".")) {
    node = node && node.children ? node.children[seg] : undefined;
    if (!node) return null;
  }
  return node;
}

export function s05AnimDuration(path) {
  const node = s05LookupAnimNode(path);
  return node && typeof node.duration === "number" ? node.duration : 0;
}

/** .loader-cube div with 9 .sk-cube.sk-cubeN children. */
export function s05CreateLoaderCube(parent) {
  const cube = env().createDiv("loader-cube", parent);
  for (let n = 1; n <= 9; n++) env().createDiv("sk-cube sk-cube" + n, cube);
  return cube;
}

/** .loader-spinner div with the loader-2 icon. */
export function s05CreateLoaderSpinner(parent) {
  const el = env().createDiv("loader-spinner", parent);
  env().tv(el, "loader-2");
  return el;
}

/** Show a spinner while `task()` runs; always removed afterwards. */
export async function s05WithLoader(parent, task) {
  const spinner = s05CreateLoaderSpinner(parent);
  try {
    return await task();
  } finally {
    if (spinner.detach) spinner.detach();
    else if (spinner.remove) spinner.remove();
  }
}

/** First non-word character index >= from, or -1. */
export function s05FindBreakIndex(text, from) {
  for (let i = from; i < text.length; i++) {
    if (/\W/.test(text.charAt(i))) return i;
  }
  return -1;
}

/** Max numeric footnote id (excluding "[inline...") + 1; 1 when none. */
export function s05NextFootnoteId(node) {
  let max = 0;
  const list = node && node.footnotes;
  if (list) {
    for (const f of list) {
      const id = f && f.id !== undefined && f.id !== null ? String(f.id) : "";
      if (id.indexOf("[inline") === 0) continue;
      const n = parseInt(id, 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}

/** `cssclasses` frontmatter as filtered single-token classes, or null. */
export function s05CssClasses(frontmatter) {
  const list = frontmatterStrings(frontmatter, /^cssclasses$/i);
  if (!list) return null;
  return list.filter((c) => !!c && !/\s/.test(c));
}

// ---------------------------------------------------------------- system info / vaults

/** Diagnostic text block for the debug-info pane. */
export function s05SystemInfo() {
  const p = env().Yl || {};
  const mobile = !!(p.isMobileApp || p.isMobile || p.isAndroidApp || p.isIosApp);
  const lines = ["SYSTEM INFO:"];
  if (mobile) {
    lines.push("Basalt version: " + p.version + " (" + p.build + ")");
    lines.push("API version: " + env().gte);
    const os = [p.osName, p.osVersion].filter(Boolean).join(" ");
    const mm = [p.manufacturer, p.model].filter(Boolean).join(" ").trim();
    lines.push("OS: " + os + (mm ? " (" + mm + ")" : ""));
    if ((p.isAndroidApp || env().Sm) && typeof navigator !== "undefined" && navigator.userAgent) {
      const cv = chromeVersion(navigator.userAgent);
      if (cv) lines.push("Webview version: " + cv);
    }
  } else {
    lines.push("Basalt version: " + p.version);
    let installer = "unknown";
    try {
      env().Of((e) => {
        if (e && e.app && typeof e.app.getVersion === "function") installer = e.app.getVersion();
      });
    } catch { /* no bridge */ }
    lines.push("Installer version: " + installer);
    lines.push("OS: " + [p.osName, p.osVersion].filter(Boolean).join(" "));
    let insider = false;
    try {
      env().Of((e) => {
        insider = !!(e && e.ipcRenderer && e.ipcRenderer.sendSync("insider-build", null));
      });
    } catch { /* no bridge */ }
    lines.push("Insider build toggle: " + (insider ? "on" : "off"));
  }
  const hw = env().Hw || {};
  lines.push("Login status: " + (hw.token ? "logged in" : "not logged in"));
  lines.push("Language: " + (env().sm ? env().sm() : ""));
  if (hw.token) lines.push("Catalyst license: " + (hw.license || "none"));
  return lines.join("\n");
}

async function ng25CollectVault(adapter, subdir, prefix, storageType, excludes, out) {
  let entries;
  try {
    entries = await adapter.readdir(subdir);
  } catch (e) {
    console.error(e);
    return;
  }
  for (const en of entries || []) {
    const name = en && en.name;
    if (!name || name.charAt(0) === ".") continue;
    if (excludes && excludes.has(name)) continue;
    if (en.type === "directory") out.push({ name, location: prefix + name, storageType });
  }
}

/** Vault list for mobile platforms; [] elsewhere. */
export async function s05MobileVaultList() {
  const out = [];
  if (env().Mm) {
    if (env().yD) await ng25CollectVault(env().yD, env().wD || "", "icloud/", "iCloud", null, out);
    if (env().vD) await ng25CollectVault(env().vD, "", "documents/", "local", null, out);
    return out;
  }
  if (env().Sm) {
    if (!(await s05CheckFilePermissions())) return out;
    const excludes = new Set();
    const base = env().vD && env().vD.getUri ? env().vD.getUri("") : "";
    for (const dir of env().gD || []) {
      try {
        const uri = env().bD.getUri(dir);
        if (base && uri.indexOf(base + "/") === 0) {
          const rest = uri.slice(base.length + 1);
          if (rest && rest.indexOf("/") === -1) excludes.add(decodeURIComponent(rest));
        }
        const st = await env().bD.stat(dir);
        if (st && st.type === "directory") {
          out.push({ name: lastSegment(dir), location: dir, storageType: "local" });
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (env().vD) await ng25CollectVault(env().vD, "", "", "local", excludes, out);
  }
  return out;
}

// ---------------------------------------------------------------- DOM glue

/** macOS desktop: double-click titlebar -> minimize/maximize per system preference. */
export function s05TitlebarDoubleClick(element) {
  const p = env().Yl;
  if (!p || !p.isMacOS || !p.isDesktopApp) return;
  element.addEventListener("dblclick", (event) => {
    if (event.button !== 0) return;
    const t = event.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.closest(".clickable-icon") || t.closest(".workspace-tab-header-inner-close-button")) return;
    const tab = t.closest(".workspace-tab-header");
    if (tab && tab.closest(".workspace-split.mod-sidedock")) return;
    const win = element.win && element.win.electronWindow;
    if (!win || !win.isMaximizable) return;
    try {
      env().Of((e) => {
        const sp = e && e.remote && e.remote.systemPreferences;
        const pref = sp ? sp.getUserDefault("AppleActionOnDoubleClick", "string") : "";
        if (pref === "Minimize") win.minimize();
        else if (pref === "Maximize" || pref === "") {
          if (typeof win.isMaximized === "function" && win.isMaximized()) win.unmaximize();
          else win.maximize();
        }
      });
    } catch { /* no bridge */ }
  });
}

/** Wheel deltaY -> horizontal scroll on the event's currentTarget. */
export function s05WheelScroll(event) {
  if (!event.deltaY) return;
  const el = event.currentTarget;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) el.scrollLeft += event.deltaX;
  else el.scrollLeft += event.deltaY;
  event.preventDefault();
}
