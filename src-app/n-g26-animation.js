// g26 clean-room: script-driven CSS transitions (spec g26 Part A).
// A Transition spec collects per-stage style maps; runTransition applies `from`
// synchronously, defers the animated start to a shared next-tick flush (one
// forced layout for the whole batch) and finishes on transitionend or a safety
// timer; cancelTransition finishes early. Running state lives in a WeakMap.

const ng26Running = new WeakMap();   // el -> run record
const ng26Pending = [];              // run records awaiting the shared flush
let ng26FlushArmed = false;

function ng26WinOf(el) {
  return el.win || (typeof window !== "undefined" ? window : null);
}

function ng26ApplyStyles(el, stage) {
  if (!stage) return;
  for (const name of Object.keys(stage)) el.style[name] = stage[name];
}

function ng26Finish(run, silent) {
  const el = run.el;
  const spec = run.spec;
  if (run.timer != null) {
    const w = ng26WinOf(el);
    if (w) w.clearTimeout(run.timer);
    run.timer = null;
  }
  el.removeEventListener("transitionend", run.onTransitionEnd);
  el.style.transition = "";
  el.style.transitionProperty = "";
  ng26ApplyStyles(el, spec.end);
  if (ng26Running.get(el) === run) ng26Running.delete(el);
  run.dead = true;
  if (!silent && run.onDone) run.onDone.call(run);
}

function ng26Start(run) {
  const el = run.el;
  const spec = run.spec;
  el.style.transition = "all " + spec.duration + "ms " + spec.fn;
  el.style.transitionProperty = Object.keys(spec.from).join(", ");
  ng26ApplyStyles(el, spec.to);
  run.onTransitionEnd = (event) => {
    if (event.target === el) ng26Finish(run, false);
  };
  el.addEventListener("transitionend", run.onTransitionEnd);
  const w = ng26WinOf(el);
  run.timer = w ? w.setTimeout(() => ng26Finish(run, false), spec.duration + 50) : null;
}

function ng26Flush() {
  ng26FlushArmed = false;
  if (typeof document !== "undefined" && document.body) void document.body.offsetHeight;
  const batch = ng26Pending.splice(0);
  for (const run of batch) {
    if (!run.dead && ng26Running.get(run.el) === run) ng26Start(run);
  }
}

export function ng26RunTransition(el, spec, onDone) {
  const prev = ng26Running.get(el);
  if (prev) ng26Finish(prev, false);
  const run = { el, spec, onDone: onDone || null, timer: null, dead: false };
  ng26Running.set(el, run);
  ng26ApplyStyles(el, spec.from);
  ng26Pending.push(run);
  if (!ng26FlushArmed) {
    ng26FlushArmed = true;
    const w = ng26WinOf(el) || (typeof window !== "undefined" ? window : null);
    if (w) w.setTimeout(ng26Flush, 0);
  }
}

export function ng26CancelTransition(el, silent) {
  const run = ng26Running.get(el);
  if (run) ng26Finish(run, !!silent);
}

export { ng26RunTransition as runTransition, ng26CancelTransition as cancelTransition };

export function ng26DefineTransition(host) {
  class Transition {
    constructor(options) {
      const o = options || {};
      this.from = {};
      this.to = {};
      this.end = {};
      this.duration = o.duration === undefined ? 100 : o.duration;
      this.fn = o.fn === undefined ? "ease-in-out" : o.fn;
    }

    addProp(name, from, to, end) {
      if (from !== null && from !== undefined) this.from[name] = from;
      if (to !== null && to !== undefined) this.to[name] = to;
      if (end === undefined) end = null;
      if (end !== null) this.end[name] = end;
      return this;
    }
  }
  return Transition;
}
