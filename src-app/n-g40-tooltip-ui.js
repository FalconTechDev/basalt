// g40 clean-room: tooltip delegation — aria-label hover handlers, attribute-driven
// show, per-document install (spec g40 Part B).

import { ng40Dynamic, ng40HideTooltip, ng40CancelTooltipDelay, ng40DisplayTooltip, ng40NoTip } from "./n-g40-tooltip.js";

let ng40Pred = () => true;
let ng40Synth = () => false;

export function ng40InitTooltips(host) {
  if (host && host.pointerEntered) ng40Pred = (e, el) => host.pointerEntered(e, el);
  if (host && host.isTouchSyntheticMouse) ng40Synth = (e) => host.isTouchSyntheticMouse(e);
  return null;
}

export function ng40ShowTooltipFromAttributes(el) {
  ng40CancelTooltipDelay();
  const dyn = ng40Dynamic.get(el);
  const text = dyn ? dyn(el) : el.getAttribute("aria-label") || "";
  const placement = el.getAttribute("data-tooltip-position") || "bottom";
  const clsAttr = el.getAttribute("data-tooltip-classes");
  const classes = clsAttr == null ? [] : clsAttr.split(" ");
  const delayAttr = el.getAttribute("data-tooltip-delay");
  const parsed = delayAttr == null ? NaN : parseInt(delayAttr, 10);
  const delay = Number.isNaN(parsed) ? 1000 : parsed;
  ng40DisplayTooltip(el, text, { placement, classes, delay });
}

function ng40ClosestLabel(node) {
  const el = node && node.nodeType === 1 ? node : node && node.parentElement;
  return el && el.closest ? el.closest("[aria-label]") : null;
}

export function ng40OnTooltipPointerOver(event, el) {
  if (!el || event.pointerType === "touch") return;
  if (ng40NoTip(el)) return;
  if (!ng40Pred(event, el) || ng40Synth(event)) return;
  ng40ShowTooltipFromAttributes(el);
}

export function ng40OnTooltipPointerOut(event, el) {
  if (!el || event.pointerType === "touch") return;
  const rel = event.relatedTarget;
  const relLabel = rel && rel.nodeType === 1 ? ng40ClosestLabel(rel) : null;
  if (relLabel === el) return;
  ng40HideTooltip();
  if (relLabel) ng40ShowTooltipFromAttributes(relLabel);
}

export function ng40InstallTooltipHandlers(doc) {
  const d = doc || document;
  const body = d.body || d.documentElement;
  if (!body || body.__ng40Tips) return;
  body.__ng40Tips = true;
  body.addEventListener("pointerover", (event) => {
    const el = ng40ClosestLabel(event.target);
    if (el) ng40OnTooltipPointerOver(event, el);
  });
  body.addEventListener("pointerout", (event) => {
    const el = ng40ClosestLabel(event.target);
    if (el) ng40OnTooltipPointerOut(event, el);
  });
  body.addEventListener("pointerup", () => ng40HideTooltip());
}
