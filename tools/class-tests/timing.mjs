// debounce (wc): driven by a virtual clock with two "windows"; the sequence of fn calls with their timestamps must be identical.
import { debounceCall } from "../../src-app/timing.js";

function clock(log) {
  let now = 0, seq = 0;
  const timers = new Map();
  const mkWin = (name) => ({
    name,
    setTimeout: (f, ms) => { const id = ++seq; timers.set(id, { f, at: now + Math.max(0, ms | 0), win: name }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  });
  const wins = [mkWin("A"), mkWin("B")];
  return {
    wins,
    get now() { return now; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [id, t] of timers) if (t.at <= end && (!best || t.at < best.t.at || (t.at === best.t.at && id < best.id))) best = { id, t };
        if (!best) break;
        now = Math.max(now, best.t.at);
        timers.delete(best.id);
        log.push(["fire@", now, best.t.win]);
        best.t.f();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

export const cases = [
  {
    orig: "wc", use: "debounceCall",
    origWorld: (O) => ({ deb: O(["fn:wc"]).wc }),
    ownWorld: () => ({ deb: debounceCall }),
    scenario({ deb }, { log, rnd }) {
      const clk = clock(log);
      const realNow = Date.now;
      let cur = 0;
      Date.now = () => clk.now;
      globalThis.activeWindow = clk.wins[0];
      try {
        const calls = [];
        const wait = rnd.pick([0, 10, 50, 100]);
        const reset = rnd.bool();
        const f = deb(function (...a) { log.push(["call", clk.now, a, this && this.id]); return "r" + a[0]; }, wait, reset);
        for (let step = 0; step < 30; step++) {
          switch (rnd.i(6)) {
            case 0: case 1: log.push(["invoke", f.call({ id: step }, step) === f]); break;
            case 2: clk.advance(rnd.i(70)); break;
            case 3: cur = rnd.i(2); globalThis.activeWindow = clk.wins[cur]; log.push(["win", cur]); break;
            case 4: log.push(["run", f.run(), clk.pending()]); break;
            case 5: if (rnd.bool(0.3)) log.push(["cancel", f.cancel() === f, clk.pending()]); else clk.advance(rnd.i(200)); break;
          }
        }
        clk.advance(1000);
        log.push(["end", clk.pending()]);
      } finally { Date.now = realNow; delete globalThis.activeWindow; }
    },
  },
];
