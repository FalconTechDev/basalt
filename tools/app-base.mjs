// The ORIGINAL (minified) bundle, taken from git history, for differential tests and for checking what a build replaces.
//   loadBase("ca5acac") -> { src, fn(name) -> { text, node }, closure(names) -> JS source that defines those functions + what they need }
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import { analyze } from "./split-app.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function loadBase(rev) {
  const src = execFileSync("git", ["show", `${rev}:src/app.js`], { cwd: root, maxBuffer: 64 << 20, encoding: "utf8" });
  const file = path.join(os.tmpdir(), `basalt-app-base-${rev}.js`);
  fs.writeFileSync(file, src);
  const report = analyze(file);
  const funcs = new Map(report.functions.map((f) => [f.name, f]));
  const consts = new Map(report.consts.map((c) => [c.name, c]));
  const text = (r) => src.slice(r.start, r.end);

  function constNames(init) {
    const names = new Set();
    (function walk(n) {
      if (!n || typeof n.type !== "string") return;
      if (n.type === "Identifier") names.add(n.name);
      for (const k in n) { if (k === "type") continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v); }
    })(init);
    return [...names].filter((x) => consts.has(x));
  }

  return {
    src, report, funcs,
    fn: (name) => (funcs.has(name) ? text(funcs.get(name)) : null),
    /** JS source declaring the given functions plus every function/constant they use; evaluates to an object of those functions. */
    closure(names) {
      const needF = new Set(), needC = new Set();
      const addC = (c) => { if (needC.has(c)) return; needC.add(c); const d = acorn.parseExpressionAt(text(consts.get(c)).replace(/^[^=]+=/, ""), 0, { ecmaVersion: 2022 }); constNames(d).forEach(addC); };
      const addF = (n) => { if (needF.has(n)) return; needF.add(n); const f = funcs.get(n); if (!f) throw new Error("not a top-level function: " + n); f.deps.forEach(addF); f.constDeps.forEach(addC); };
      names.forEach(addF);
      const cs = [...needC].map((c) => consts.get(c)).sort((a, b) => a.start - b.start).map((c) => `var ${text(c)};`);
      const fs_ = [...needF].map((n) => text(funcs.get(n)));
      return `${cs.join("\n")}\n${fs_.join("\n")}\nreturn {${names.join(",")}};`;
    },
  };
}
