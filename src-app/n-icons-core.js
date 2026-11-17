// Own icon system (stage 0): providers for the two inherited icon tables.
//   Um -> nIconsUm()   Lucide table, name -> Gm item list (arrays)
//   Qm -> nIconsQm()   app-icon table, name -> svg innerHTML (strings)
// Drawings live in piece modules src-app/n-icons-set-*.js: each exports a plain
// object { name: items } for Um or { name: "<svg inner>" } for Qm (the value
// type decides). Register a new piece in NGL_PIECES below. Names without a
// drawing still resolve: they get the fallback glyph (chamfered square + ?).
import { nIconsLucideNames } from "./n-icons-names.js";
import { nIconsSetBasic } from "./n-icons-set-basic.js";
import { nIconsSetIc2a } from "./n-icons-set-ic2a.js";
import { nIconsSetIc2b } from "./n-icons-set-ic2b.js";
import { nIconsSetIc2c } from "./n-icons-set-ic2c.js";
import { nIconsSetIc2d } from "./n-icons-set-ic2d.js";
import { nIconsSetIc2e } from "./n-icons-set-ic2e.js";
import { nIconsSetIc2f } from "./n-icons-set-ic2f.js";
import { nIconsSetIc2g } from "./n-icons-set-ic2g.js";
import { nIconsSetIc2h } from "./n-icons-set-ic2h.js";
import { nIconsSetIc2i } from "./n-icons-set-ic2i.js";

import { nIconsSetIc1a } from "./n-icons-set-ic1a.js";
import { nIconsSetIc1b } from "./n-icons-set-ic1b.js";
import { nIconsSetIc1c } from "./n-icons-set-ic1c.js";
import { nIconsSetIc1d } from "./n-icons-set-ic1d.js";
import { nIconsSetIc1e } from "./n-icons-set-ic1e.js";

import { nIconsSetIc3a } from "./n-icons-set-ic3a.js";
import { nIconsSetIc3b } from "./n-icons-set-ic3b.js";
import { nIconsSetIc3c } from "./n-icons-set-ic3c.js";
import { nIconsSetIc3d } from "./n-icons-set-ic3d.js";
import { nIconsSetIc3e } from "./n-icons-set-ic3e.js";
import { nIconsSetIc3f } from "./n-icons-set-ic3f.js";

// Piece registry: resolved lazily inside nIconsCollect (module order in the
// flat own scope is alphabetical, so a top-level reference would hit TDZ).
// Drawing agents append their piece module here.
function nIconsPieces() {
  return [nIconsSetBasic, nIconsSetIc2a, nIconsSetIc2b, nIconsSetIc2c, nIconsSetIc2d, nIconsSetIc2e, nIconsSetIc2f, nIconsSetIc2g, nIconsSetIc2h, nIconsSetIc2i];

  return [nIconsSetBasic, nIconsSetIc1a, nIconsSetIc1b, nIconsSetIc1c, nIconsSetIc1d, nIconsSetIc1e];

  return [nIconsSetBasic, nIconsSetIc3a, nIconsSetIc3b, nIconsSetIc3c, nIconsSetIc3d, nIconsSetIc3e, nIconsSetIc3f];
}

// The 36 names of the inherited Qm table (app-specific glyphs). They keep
// resolving through the Qm branch of ev() so aliases and classes are unchanged.
const NGL_QM_NAMES = [
  "refresh-cw-off", "bracket-glyph", "box-glyph", "check-small", "dice-glyph",
  "right-triangle", "heading-glyph", "keyboard-toggle", "broken-link",
  "left-arrow", "link-glyph", "links-coming-in", "links-going-out",
  "open-vault", "question-mark-glyph", "right-arrow", "sidebar-left",
  "sidebar-right", "sheets-in-box", "star-list", "sync-small",
  "uppercase-lowercase-a", "stack-horizontal", "stack-vertical",
  "stretch-horizontal", "stretch-vertical", "distribute-space-horizontal",
  "distribute-space-vertical", "zoom-to-selection", "create-group",
  "snap-to-object", "line-horizontal", "aspect-ratio",
  "rectangle-vertical-double", "tab-frame", "sidebar-toggle-button-icon",
];

// Fallback glyph, Basalt language: chamfered square + question mark of segments.
const NGL_FB_D = "M7 5H17L19 7V17L17 19H7L5 17V7Z";
const NGL_FB_Q = "M9.5 7.5H14.5L16 9V10.5H14L12.5 12V14";
const NGL_FB_DOT = "M12 16.5H13";
const NGL_FB_ITEMS = [[6, NGL_FB_D], [6, NGL_FB_Q], [6, NGL_FB_DOT]];
const NGL_FB_HTML =
  '<path d="' + NGL_FB_D + '"/><path d="' + NGL_FB_Q + '"/><path d="' + NGL_FB_DOT + '"/>';

function nIconsCollect() {
  const um = {};
  const qm = {};
  for (const piece of nIconsPieces()) {
    for (const name in piece) {
      const v = piece[name];
      if (typeof v === "string") qm[name] = v;
      else um[name] = v;
    }
  }
  return { um, qm };
}

// Um replacement: every icon name resolves (drawn piece or fallback glyph), so
// ev()'s hasOwnProperty checks keep working for arbitrary plugin names too.
// ownKeys/getIconIds report the known Lucide name universe plus drawn extras.
export function nIconsUm() {
  const { um } = nIconsCollect();
  const names = nIconsLucideNames.slice();
  for (const name in um) if (!nIconsLucideNames.includes(name)) names.push(name);
  const target = {};
  return new Proxy(target, {
    has(t, k) {
      return typeof k === "string";
    },
    get(t, k) {
      if (typeof k !== "string" || k in t || k in Object.prototype) return Reflect.get(t, k);
      return um[k] || NGL_FB_ITEMS;
    },
    getOwnPropertyDescriptor(t, k) {
      if (typeof k !== "string") return undefined;
      return { configurable: true, enumerable: true, writable: true, value: um[k] || NGL_FB_ITEMS };
    },
    ownKeys() {
      return names.slice();
    },
  });
}

// Qm replacement: plain object over the inherited name set; undrawn names get
// the fallback innerHTML so app glyphs never render blank.
export function nIconsQm() {
  const { qm } = nIconsCollect();
  const out = {};
  for (const name of NGL_QM_NAMES) out[name] = qm[name] || NGL_FB_HTML;
  for (const name in qm) if (!out[name]) out[name] = qm[name];
  return out;
}
