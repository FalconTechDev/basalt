// Removes /* section */ comments that no longer precede any rule
// (their rules were deleted). A comment is orphaned when the next
// sibling in the same parent is another comment or nothing at all.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "package.json"));
const postcss = require("postcss");
const src = path.resolve(here, "..", "src-css");
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) files.push(p); } };
walk(src);

for (const file of files) {
  const root = postcss.parse(fs.readFileSync(file, "utf8"));
  let removed = 0;
  const clean = (nodes) => {
    // mark from the end: a comment is dead if everything after it (in this
    // parent) is dead comments or nothing
    let tailDead = true;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type === "comment") {
        if (tailDead) { n.remove(); removed++; continue; }
        tailDead = false;
      } else if (n.type === "rule" || (n.type === "atrule" && n.nodes && n.nodes.length)) {
        tailDead = false;
      } else if (n.type === "atrule") {
        clean(n.nodes || []);
        if (n.nodes && n.nodes.length === 0) { n.remove(); continue; }
        tailDead = false;
      }
    }
  };
  clean(root.nodes);
  if (removed) { console.log(`${path.relative(src, file)}: -${removed} orphan comment(s)`); fs.writeFileSync(file, root.toString()); }
}
