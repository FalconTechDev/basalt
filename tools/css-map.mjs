// Maps a stylesheet: parses it with postcss, classifies every rule into a component bucket and prints / writes the grouping.
//   node tools/css-map.mjs [file.css] [--json out.json]        (default file: src/app.css)
// The classifier is shared with tools/css-split.mjs, which uses it to lay out src-css/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const here = path.dirname(fileURLToPath(import.meta.url));

// Bucket name -> test on the selector text. First match wins, so order goes from the most specific component to the general ones.
export const BUCKETS = [
  ["pdf", /\.pdf-|\.pdfViewer|\.textLayer|\.annotationLayer|\.page\b|#viewer|\.messageBar|#toolbarContainer|\.toolbarButton|\.splitToolbarButton|\.dropdownToolbarButton|#sidebarContainer|\.thumbnail|\.outlineItem|\.findbar|#findbar|\.secondaryToolbar|#secondaryToolbar|\.doorHanger|\.verticalToolbar|\.editor(Param|Toolbar)|\.altText|\.annotationEditor|\.xfa|#outerContainer|\.toolbarField|\.visibleLargeView|\.hiddenLargeView|\.attachmentsItem|\.treeItem|#pageNumber|#scaleSelect|\.loadingBar|\.progress\b|\.dialog\b|\.clearInputButton|\.toolbarHorizontalGroup|\.editorHighlight|\.highlight(Outline|Edit)|\.stampEditor|\.basicColorPicker|\.colorPicker|\.signature|\.commentPopup|\.comment(Dialog|Manager|Button)|\.thumbnailSelection/],
  ["mobile", /\.is-mobile|\.is-phone|\.is-tablet|\.mobile-/],
  ["canvas", /\.canvas|\.fp-canvas|\.pixi/],
  ["graph", /\.graph-|\.fp-graph|\.local-graph/],
  ["modal", /\.modal|\.prompt\b|\.prompt-|\.mod-(community|settings)|\.vertical-tab|\.setting-|\.installed-plugins|\.community-|\.hotkey-|\.checkbox-container|\.dialog-/],
  ["suggest", /\.suggestion|\.prompt-|\.omnisearch/],
  ["menu", /\.menu\b|\.menu-/],
  ["tooltip", /\.tooltip|\.notice/],
  ["explorer", /\.nav-|\.tree-item|\.file-explorer|\.search-result|\.search-input|\.outgoing-link|\.backlink|\.tag-pane|\.bookmark|\.outline|\.pane-|\.workspace-leaf-content\[data-type/],
  ["tabs", /\.workspace-tab|\.tab-|\.mod-tab|\.view-header|\.view-actions|\.clickable-icon|\.sidebar-toggle|\.titlebar|\.horizontal-main|\.status-bar|\.ribbon|\.workspace-ribbon/],
  ["workspace", /\.workspace|\.mod-root|\.mod-sidedock|\.mod-left|\.mod-right|\.sidebar|\.app-container|\.app-|\.is-popout|\.is-grabbing|\.drag|\.resize|\.hover-popover|\.popover/],
  ["editor", /\.cm-|\.CodeMirror|\.markdown-source|\.is-live-preview|\.mod-cm|\.HyperMD|\.cm6/],
  ["preview", /\.markdown-|\.markdown-preview|\.markdown-rendered|\.callout|\.internal-embed|\.external-link|\.internal-link|\.table-|\.math|\.frontmatter|\.metadata|\.heading|\.footnote|\.task-list|\.list-bullet|\.collapse-indicator|\.copy-code|\.code-block|\.mod-header|\.mod-footer|\.inline-title|\.embed|\.image-embed|\.pdf-embed|\.hr\b|\.tag\b/],
  ["form", /^(input|button|select|textarea|label)\b|^input|\.dropdown|\.checkbox|\.slider|\.toggle|\.text-input|\.mod-cta|\.mod-warning|\.mod-muted|button\b|\.clickable|\.search-input-container/],
  ["scrollbar", /scrollbar|::-webkit-scrollbar/],
  ["utilities", /^\.(is-|mod-|u-|hide|hidden|visually|flex|inline|block|text-)|\.is-hidden|\.is-flashing|\.is-loading|\.svg-icon|\.lucide|\.icon/],
];

export function bucketOf(sel, atRoot) {
  if (/^(:root|\.theme-(dark|light)|body|html|\.css-settings|\.theme)/.test(sel) && !/ /.test(sel.trim())) return "tokens";
  for (const [name, re] of BUCKETS) if (re.test(sel)) return name;
  return "base";
}

export function parse(file) {
  const css = fs.readFileSync(file, "utf8");
  return postcss.parse(css, { from: file });
}

// A rule's bucket is decided by its selectors; a rule with selectors in several buckets goes to the one of its first selector.
export function classify(rule, inMedia) {
  const sel = rule.selector;
  if (inMedia && /print/.test(inMedia)) return "print";
  if (inMedia && /max-width|pointer|hover/.test(inMedia) && !/\.is-/.test(sel)) { /* responsive rules stay with their component */ }
  return bucketOf(sel.split(",")[0].trim());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = path.resolve(args.find((a) => !a.startsWith("--") && a !== args[args.indexOf("--json") + 1]) || path.join(here, "..", "src", "app.css"));
  const root = parse(file);
  const stat = new Map();
  const add = (b, rule, bytes) => { const s = stat.get(b) || { rules: 0, decls: 0, bytes: 0, at: 0 }; s.rules++; s.decls += rule.nodes?.length || 0; s.bytes += bytes; stat.set(b, s); };
  let atrules = new Map();
  root.walk((n) => {
    if (n.type === "atrule") atrules.set(n.name, (atrules.get(n.name) || 0) + 1);
    if (n.type === "rule" && !(n.parent.type === "atrule" && /keyframes$/.test(n.parent.name))) {
      const media = n.parent.type === "atrule" ? n.parent.params : "";
      add(classify(n, media), n, n.toString().length);
    }
  });
  console.log("bucket        rules   decls    bytes");
  for (const [k, v] of [...stat].sort((a, b) => b[1].bytes - a[1].bytes)) console.log(k.padEnd(12), String(v.rules).padStart(7), String(v.decls).padStart(7), String(v.bytes).padStart(8));
  console.log("at-rules:", Object.fromEntries(atrules));
  const j = args.indexOf("--json");
  if (j >= 0) fs.writeFileSync(args[j + 1], JSON.stringify(Object.fromEntries(stat), null, 1));
}
