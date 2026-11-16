// Removes CSS rules that can never match because they positively require a
// class that no shipped source ever adds. A class inside :not() does NOT make
// a rule dead (it is always satisfied), so only classes outside negations count.
// Selector lists are filtered branch by branch; rules left with no branches
// are removed, and emptied at-rules are removed too.
//   node tools/css-drop-dead.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "package.json"));
const postcss = require("postcss");
const parser = require("postcss-selector-parser");

const DEAD = new Set([
  // vault picker / starter screen (Basalt uses starter.html + vault-list instead)
  "slug-input", "open-vault-options", "open-vault-options-container", "starter-screen",
  "recent-vaults", "webviewer-container", "splash-brand",
  // removed features: card view, community readme, old settings text, publish/sync UI
  "card", "card-container", "card-title", "card-description",
  "community-readme", "setting-text", "setting-explanation",
  "publish-changes-buttons", "sync-history-content-buttons", "sync-modal-buttons",
  // never-added classes
  "node-insert-event", "site-list-item-name", "base-toolbar-groupby-item",
  "u-clickable", "hidden-token", "nav-file-icon", "canvas-cursor",
  "metadata-error-cta", "table-col-drag-ghost",
  "input-button", "open-folder-button", "open-folder-input",
  "fold-gutter",
  // mobile parts Basalt does not render
  "mobile-vault-chooser-screen", "mobile-vault-chooser-header", "mobile-vault-chooser-content",
  "mobile-vault-chooser-action-description", "mobile-vault-chooser-version", "mobile-vault-chooser-actions",
  "mobile-tab-switcher-search", "mobile-tab-footer",
  // workspace drawer parts not emitted
  "workspace-drawer-separator", "workspace-drawer-actions", "workspace-drawer-action-icon",
  "workspace-drawer-action-item", "workspace-drawer-action-short-name",
  "workspace-drawer-header-name-action-icon", "workspace-drawer-active-tab-icon",
  // embedded-element classes no renderer emits
  "el-blockquote", "el-p", "el-pre", "el-table", "el-ul", "el-ol",
]);

const dry = process.argv.includes("--dry");
const src = path.resolve(here, "..", "src-css");
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) files.push(p); } };
walk(src);

// does this complex selector positively require a dead class?
function selectorIsDead(sel) {
  let dead = false;
  parser((root) => {
    root.walkClasses((c) => {
      // walk up: if any ancestor is a :not() pseudo, this class does not require presence
      let p = c.parent, negated = false;
      while (p) {
        if (p.type === "pseudo" && p.value === ":not") { negated = true; break; }
        p = p.parent;
      }
      if (!negated && DEAD.has(c.value)) dead = true;
    });
  }).processSync(sel);
  return dead;
}

let totalRemoved = 0;
for (const file of files.sort()) {
  const css = fs.readFileSync(file, "utf8");
  const root = postcss.parse(css);
  const removed = [];
  root.walkRules((rule) => {
    if (rule.parent && rule.parent.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    const kept = rule.selectors.filter((s) => !selectorIsDead(s));
    if (kept.length === rule.selectors.length) return;
    removed.push(...rule.selectors.filter((s) => !kept.includes(s)));
    if (kept.length === 0) rule.remove();
    else rule.selector = kept.join(", ");
  });
  // drop at-rules that no longer contain rules
  root.walkAtRules((at) => {
    if (at.nodes && at.nodes.every((n) => n.type === "comment" || (n.type === "atrule" && n.nodes && n.nodes.every((x) => x.type === "comment")))) at.remove();
  });
  if (removed.length) {
    totalRemoved += removed.length;
    console.log(`${path.relative(src, file)}: -${removed.length} selector(s)`);
    for (const s of removed.slice(0, 15)) console.log(`   ${s.slice(0, 110)}`);
    if (removed.length > 15) console.log(`   ... +${removed.length - 15}`);
    if (!dry) fs.writeFileSync(file, root.toString());
  }
}
console.log(`\n${dry ? "would remove" : "removed"} ${totalRemoved} dead selectors`);
