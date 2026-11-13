// Compares two outputs of tools/ws-scenario.mjs step by step and shows where the first difference of each differing step is.
//   node tools/ws-diff.mjs base.json new.json
import fs from "node:fs";
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const a = read(process.argv[2]), b = read(process.argv[3]);
let bad = 0;
for (let i = 0; i < Math.max(a.steps.length, b.steps.length); i++) {
  const x = JSON.stringify(a.steps[i]) || "", y = JSON.stringify(b.steps[i]) || "";
  if (x === y) continue;
  bad++;
  let k = 0;
  while (k < x.length && x[k] === y[k]) k++;
  console.log(`DIFF step ${i} ${(a.steps[i] || {}).step} at char ${k}:\n  base: ...${x.slice(Math.max(0, k - 80), k + 160)}\n  new : ...${y.slice(Math.max(0, k - 80), k + 160)}`);
}
console.log(`steps ${a.steps.length}/${b.steps.length}, differing ${bad}; runtime problems base ${a.problems.length}, new ${b.problems.length}`);
for (const p of b.problems.slice(0, 5)) console.log("  new problem:", p);
for (const s of b.steps.filter((s) => s.error)) console.log("  step error:", s.step, s.error);
process.exit(bad ? 1 : 0);
