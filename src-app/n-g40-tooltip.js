// g40 clean-room: tooltip core — state, display/positioning, setters (spec g40 Part B).
// One visible tooltip at a time; per-element dynamic text via WeakMap; quick-follow
// (<100 ms after a hide) skips the delay.

export const ng40Tip = {
  el: null,        // visible .tooltip element
  label: null,     // its text child
  target: null,    // element it describes
  delayTimer: null,
  lastHidden: 0,
  pending: null,   // {el, text, options} waiting for the delay
};

export const ng40Dynamic = new WeakMap();

export function ng40HideTooltip() {
  ng40CancelTooltipDelay();
  if (ng40Tip.el) { ng40Tip.el.remove(); ng40Tip.el = null; }
  ng40Tip.target = null;
  ng40Tip.label = null;
  ng40Tip.lastHidden = Date.now();
}

export function ng40CancelTooltipDelay() {
  if (ng40Tip.delayTimer !== null) { clearTimeout(ng40Tip.delayTimer); ng40Tip.delayTimer = null; }
  ng40Tip.pending = null;
}

export function ng40TooltipsDisabled(el) {
  try {
    return getComputedStyle(el).getPropertyValue("--no-tooltip").trim() === "true";
  } catch {
    return false;
  }
}

export function ng40NoTip(node) {
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    if (ng40TooltipsDisabled(n)) return true;
  }
  return false;
}

function ng40IsShown(el) {
  return typeof el.isShown === "function" ? el.isShown() : true;
}

function ng40DocOf(el) {
  return el.doc || el.ownerDocument || document;
}

function ng40Place(tip, anchor, placement, gap) {
  const doc = anchor.ownerDocument || document;
  const body = doc.body;
  tip.style.top = tip.style.left = tip.style.width = tip.style.height = "";
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const r = anchor.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let top;
  let left;
  if (placement === "top") {
    top = r.top - h - gap - 5;
    left = cx - w / 2;
  } else if (placement === "left") {
    top = cy - h / 2;
    left = r.left - w - gap;
  } else if (placement === "right") {
    top = cy - h / 2;
    left = r.right + gap;
  } else {
    top = r.bottom + gap;
    left = cx - w / 2;
  }
  const bh = body.clientHeight || doc.documentElement.clientHeight;
  const bw = body.clientWidth || doc.documentElement.clientWidth;
  top = Math.min(Math.max(top, gap), Math.max(gap, bh - h - gap));
  let arrowX = null;
  if (placement !== "left" && placement !== "right") {
    if (left + w > bw - gap) left = bw - gap - w;
    if (left < gap) left = gap;
    arrowX = cx - left;
  }
  tip.style.top = top + "px";
  tip.style.left = left + "px";
  tip.style.width = w + "px";
  tip.style.height = h + "px";
  if (arrowX !== null) tip.querySelector(".tooltip-arrow").style.left = arrowX + "px";
}

function ng40ShowNow(el, text, options) {
  const doc = ng40DocOf(el);
  if (ng40Tip.el && ng40Tip.target === el) {
    ng40Tip.label.textContent = String(text);
    return;
  }
  ng40HideTooltip();
  const tip = doc.createElement("div");
  tip.className = "tooltip";
  for (const c of options.classes || []) if (c) tip.classList.add(c);
  const placement = options.placement || "bottom";
  if (placement === "right") tip.classList.add("mod-right");
  else if (placement === "left") tip.classList.add("mod-left");
  else if (placement === "top") tip.classList.add("mod-top");
  const label = doc.createElement("div");
  label.textContent = String(text);
  const arrow = doc.createElement("div");
  arrow.className = "tooltip-arrow";
  tip.appendChild(label);
  tip.appendChild(arrow);
  (doc.body || doc.documentElement).appendChild(tip);
  ng40Place(tip, options.horizontalParent || el, placement, options.gap == null ? 8 : options.gap);
  ng40Tip.el = tip;
  ng40Tip.label = label;
  ng40Tip.target = el;
}

export function ng40DisplayTooltip(el, text, options = {}) {
  if (!text || !el || !ng40IsShown(el)) return;
  const delay = options.delay || 0;
  const quick = ng40Tip.el !== null || Date.now() - ng40Tip.lastHidden < 100;
  if (delay > 0 && !quick) {
    ng40CancelTooltipDelay();
    ng40Tip.pending = { el, text, options };
    ng40Tip.delayTimer = setTimeout(() => {
      ng40Tip.delayTimer = null;
      const p = ng40Tip.pending;
      ng40Tip.pending = null;
      if (p) ng40ShowNow(p.el, p.text, p.options);
    }, delay);
    return;
  }
  ng40ShowNow(el, text, options);
}

export function ng40ApplyTooltipOptions(el, options = {}) {
  if (options.placement && options.placement !== "bottom") el.setAttribute("data-tooltip-position", options.placement);
  if (options.classes) el.setAttribute("data-tooltip-classes", options.classes.join(" "));
  if (options.delay) el.setAttribute("data-tooltip-delay", String(options.delay));
}

export function ng40SetElementTooltip(el, text, options = {}) {
  el.setAttribute("aria-label", text == null ? "" : String(text));
  ng40ApplyTooltipOptions(el, options);
  if (ng40Tip.target === el && ng40Tip.el) {
    const dyn = ng40Dynamic.get(el);
    const t = dyn ? dyn(el) : el.getAttribute("aria-label");
    ng40DisplayTooltip(el, t, options);
  }
}

export function ng40SetDynamicTooltip(el, getText, options = {}) {
  el.setAttribute("aria-label", "");
  ng40Dynamic.set(el, getText);
  ng40ApplyTooltipOptions(el, options);
  if (ng40Tip.target === el && ng40Tip.el) ng40DisplayTooltip(el, getText(el), options);
}
