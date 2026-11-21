// g39 clean-room: pure helpers, file 4 of 3 (spec g39 part A) — versions,
// severities, chrome version, property ids, headings, cli option summary.

export function ng39ParseVersion(text) {
  if (typeof text !== "string" || !text) return null;
  const parts = text.split(".").map((p) => parseInt(p, 10));
  for (const p of parts) if (isNaN(p)) return null;
  return parts;
}

export function ng39IsOlderVersion(current, latest) {
  const pl = ng39ParseVersion(latest);
  if (!pl) return false;
  const pc = ng39ParseVersion(current);
  if (!pc) return true;
  const n = Math.min(pc.length, pl.length);
  for (let i = 0; i < n; i++) {
    if (pc[i] !== pl[i]) return pc[i] < pl[i];
  }
  return pc.length < pl.length;
}

const NG39_SEVERITY_RANK = { error: 4, warning: 3, info: 2 };

export function ng39SeverityRank(severity) {
  return NG39_SEVERITY_RANK[severity] || 1;
}

export function ng39WorstSeverity(diagnostics) {
  let worst = "hint";
  let rank = 1;
  for (const d of diagnostics || []) {
    const sev = d && d.severity;
    const r = ng39SeverityRank(sev);
    if (r > rank) { rank = r; worst = sev; }
  }
  return worst;
}

export function ng39ChromeVersion(userAgent) {
  const m = /Chrome\/([\d.]+)/i.exec(String(userAgent));
  return m ? m[1] : "N/A";
}
