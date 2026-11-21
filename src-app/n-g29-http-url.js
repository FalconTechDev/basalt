// g29 clean-room: GitHub URL builders, project download URL and the
// theme-version compatibility picker (spec Part D).
import { env } from "./env.js";
import { s04UrlQuery } from "./n-g29-http.js";
import { s04Request } from "./n-g29-http-req.js";

const NG29_GITHUB_BASE = "https://github.com/";
const NG29_RAW_BASE = "https://raw.githubusercontent.com/";
const NG29_PROJECT_REPO = "FalconTechDev/basalt";

export function s04RawFileUrl(repo, file, ref) {
  return NG29_RAW_BASE + repo + "/" + (ref || "HEAD") + "/" + file;
}

export function s04RepoUrl(repo) {
  return NG29_GITHUB_BASE + repo;
}

export function s04ReleaseUrl(repo, tag, file) {
  return NG29_GITHUB_BASE + repo + "/releases/download/" + tag + "/" + file;
}

export function s04ProjectUrl() {
  const platform = env().Yl || {};
  const params = {};
  if (platform.isDesktopApp) {
    const proc = typeof process !== "undefined" ? process
      : (typeof window !== "undefined" ? window.process : undefined);
    const p = proc && proc.platform;
    params.os = p === "win32" ? "win" : p === "darwin" ? "mac" : "linux";
    params.arch = (proc && proc.arch) || "";
  } else if (platform.isMobileApp) {
    params.os = env().Sm ? "android" : "ios";
  }
  const query = s04UrlQuery().encodeUrlQuery(params);
  return NG29_GITHUB_BASE + NG29_PROJECT_REPO + (query ? "?" + query : "");
}

// ---------- theme version picker ----------

function ng29ParseVersion(text) {
  if (text == null) return null;
  const parts = String(text).split(".");
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 10));
}

// -1: a < b, 0: equal, 1: a > b; null when either side is unparseable.
function ng29CompareVersions(a, b) {
  const pa = ng29ParseVersion(a);
  const pb = ng29ParseVersion(b);
  if (!pa || !pb) return null;
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  if (pa.length === pb.length) return 0;
  return pa.length < pb.length ? -1 : 1;
}

// True when the running app version is older than the required one.
// An unparseable required version counts as older than anything parseable;
// an unparseable app version counts as older than any parseable requirement.
function ng29AppOlderThan(appVer, required) {
  const cmp = ng29CompareVersions(appVer, required);
  if (cmp === null) {
    return ng29ParseVersion(required) !== null;
  }
  return cmp < 0;
}

export async function s04ThemeVersion(repo, manifest) {
  try {
    const version = manifest.version || null;
    const appVer = env().gte;
    const minApp = manifest.minAppVersion;
    if (!appVer || !minApp || !ng29AppOlderThan(appVer, minApp)) return version;
    const versions = await s04Request({ url: s04RawFileUrl(repo, "versions.json") }).json;
    let best = null;
    for (const candidate of Object.keys(versions || {})) {
      if (ng29AppOlderThan(appVer, versions[candidate])) continue;
      if (best === null) { best = candidate; continue; }
      const cmp = ng29CompareVersions(candidate, best);
      if (cmp === null) {
        if (ng29ParseVersion(candidate) && !ng29ParseVersion(best)) best = candidate;
      } else if (cmp > 0) best = candidate;
    }
    return best;
  } catch (err) {
    return null;
  }
}
