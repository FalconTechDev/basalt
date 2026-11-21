// g40 clean-room: shared trailing-edge debounce (spec g40 Part A).
// One pending call per debounced function; last this/args win; cancel/run control;
// the timer lives in whichever window is active so pop-outs cannot swallow calls.

function ng40ActiveWindow() {
  const w = typeof activeWindow !== "undefined" ? activeWindow : null;
  return w || window;
}

export function ng40DebounceCall(fn, wait = 0, resetTimer = false) {
  let timer = null;
  let ownerWin = null;
  let self = null;
  let args = null;
  let hasPending = false;
  let due = 0;

  const invoke = () => {
    const s = self;
    const a = args;
    self = null;
    args = null;
    hasPending = false;
    timer = null;
    return fn.apply(s, a);
  };

  const arm = (delay) => {
    const w = ng40ActiveWindow();
    ownerWin = w;
    timer = w.setTimeout(tick, Math.max(0, delay));
  };

  const tick = () => {
    timer = null;
    const now = Date.now();
    if (resetTimer && now < due) {
      arm(due - now);
      return;
    }
    const active = ng40ActiveWindow();
    if (ownerWin !== active && now >= due) {
      ownerWin = active;
      timer = active.setTimeout(tick, 0);
      return;
    }
    invoke();
  };

  function d(...a) {
    self = this;
    args = a;
    const now = Date.now();
    if (resetTimer || !hasPending) due = now + wait;
    hasPending = true;
    if (timer === null) arm(due - now);
    return d;
  }

  d.cancel = () => {
    if (timer !== null && ownerWin) ownerWin.clearTimeout(timer);
    timer = null;
    ownerWin = null;
    self = null;
    args = null;
    hasPending = false;
    return d;
  };

  d.run = () => {
    if (!hasPending) return undefined;
    if (timer !== null && ownerWin) ownerWin.clearTimeout(timer);
    timer = null;
    ownerWin = null;
    return invoke();
  };

  return d;
}
