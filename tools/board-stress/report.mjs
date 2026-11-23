// Prints a compact table from results.jsonl: node report.mjs [tagA tagB ...]  (default: every tag found)
// One row per scenario and tag with: build ms (incl. paint), DOM nodes, JS heap, median/p95/max frame ms of the camera runs.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(path.join(here, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tags = process.argv.slice(2); const f = (o) => (o && o.med != null ? o.med + '/' + o.p95 + '/' + o.max : '-');
console.log('scenario'.padEnd(14), 'tag'.padEnd(8), 'build+paint ms'.padEnd(16), 'dom'.padEnd(8), 'heap'.padEnd(6), 'pan med/p95/max'.padEnd(18), 'zoom'.padEnd(18), 'panFit'.padEnd(18), 'zoomFit');
for (const r of rows) {
  if (tags.length && !tags.includes(r.tag)) continue; if (r.scen === 'ops') continue;
  const mk = r.mk || (r.cards && r.cards.ms != null ? r.cards : null); const st = r.state || {};
  console.log((r.scen + ' ' + (r.n || '')).padEnd(14), String(r.tag).padEnd(8), (mk ? mk.ms + '+' + mk.paintMs : r.open ? r.open.setStateMs + ' open' : '-').padEnd(16), String(st.dom || (r.open && r.open.dom) || '-').padEnd(8), String(st.heap || (r.open && r.open.heap) || '-').padEnd(6), f(r.pan).padEnd(18), f(r.zoom).padEnd(18), f(r.panFit).padEnd(18), f(r.zoomFit));
}
