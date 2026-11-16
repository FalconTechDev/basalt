// Quick equivalence check of the exported s23 helpers vs the base bundle originals.
import { loadBase } from "./app-base.mjs";
import * as own from "../src-app/s23-editor.js";

const b = loadBase("ca5acac");
const orig = new Function(b.closure(["Sq", "Eq", "aP"]))();
const host = { listLinePattern: /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/ };

let fails = 0;
const eq = (label, a, b2) => { const same = JSON.stringify(a) === JSON.stringify(b2); if (!same) { fails++; console.log("DIFF", label, JSON.stringify(a), JSON.stringify(b2)); } };

for (const t of ["1. item", "  12) task [ ] x", "> - [x] y", "plain", "  3. ", "", ">>> - deep", "\t4) tab", "- [ ] c"]) {
  eq("Sq " + JSON.stringify(t), orig.Sq(t), own.s23ListMarker(t, host));
}
const eqRe = new RegExp(orig.Eq.source, orig.Eq.flags);
eq("Eq.source", eqRe.source, own.s23BreakPattern.source);
eq("Eq.flags", orig.Eq.flags, own.s23BreakPattern.flags);
for (const t of ["---", "***", "___", "> quote", "# h", "~~~", "```", "1. x", "", "  - - -", "a-b-c"]) {
  eq("Eq.test " + JSON.stringify(t), orig.Eq.test(t), own.s23BreakPattern.test(t));
}
console.log("fails=" + fails);
